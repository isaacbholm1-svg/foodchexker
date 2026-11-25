// The food chat tab: an AI that only talks about food, nutrition and recipes.
import { AnalysisError, chatAnswer, type ChatTurn } from "./ai";
import { prepareImage } from "./image";
import { addToShopping, ingredientsOf, saveRecipe } from "./recipes";
import { featureOn } from "./features";
import { t, type StringKey } from "./i18n";
import { persisted } from "./store";
import { h } from "./ui";
import { locale } from "./i18n";

interface Msg extends ChatTurn {
  sources?: { title: string; url: string }[];
  error?: boolean;
  thumb?: string; // small preview of a sent photo
  log?: string; // food the AI suggests logging
}

const KEY = "fc.chat.v1";
let messages: Msg[] = load();
let busy = false;
let draft = "";

function load(): Msg[] {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(m) ? m : [];
  } catch {
    return [];
  }
}
// The last 3 earlier chats, shown in the side menu.
interface OldChat {
  id: string;
  title: string;
  updated: number;
  messages: Msg[];
}
const history = persisted<OldChat[]>("fc.chats.v1", []);
const MAX_OLD = 3;

function archiveCurrent() {
  const msgs = messages.filter((m) => !m.error).map(({ image: _img, ...m }) => m);
  if (!msgs.length) return;
  const first = msgs.find((m) => m.role === "user")?.text ?? msgs[0].text;
  const entry: OldChat = { id: crypto.randomUUID(), title: first.replace(/\s+/g, " ").slice(0, 60), updated: Date.now(), messages: msgs };
  history.set([entry, ...history.get()].slice(0, MAX_OLD));
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.filter((m) => !m.error).slice(-300).map(({ image: _img, ...m }) => m)));
  } catch {
    /* ignore */
  }
}

const SPARKLE =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M10 2.5c.45 4.1 2.4 6.05 6.5 6.5-4.1.45-6.05 2.4-6.5 6.5-.45-4.1-2.4-6.05-6.5-6.5 4.1-.45 6.05-2.4 6.5-6.5Z"/><path fill="currentColor" d="M18.5 13.5c.25 2.25 1.25 3.25 3.5 3.5-2.25.25-3.25 1.25-3.5 3.5-.25-2.25-1.25-3.25-3.5-3.5 2.25-.25 3.25-1.25 3.5-3.5Z"/></svg>';

/** Safe mini-markdown: headings, bold, bullet and numbered lists. Text is never parsed as HTML. */
export function md(text: string): Node[] {
  const out: Node[] = [];
  let list: HTMLElement | null = null;
  const inline = (s: string) => {
    const span = h("span");
    s.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) span.append(h("strong", {}, part.slice(2, -2)));
      else if (part) span.append(part.replace(/(^|\s)\*([^*\s][^*]*)\*/g, "$1$2"));
    });
    return span;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || num) {
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = h(tag as "ul");
        out.push(list);
      }
      list.append(h("li", {}, inline(bullet ? bullet[1] : num![2])));
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const head = line.match(/^#{1,4}\s+(.*)$/);
    out.push(head ? h("h4", {}, inline(head[1])) : h("p", {}, inline(line)));
  }
  return out;
}

export function renderChat(root: HTMLElement, deps: { apiKey: string; context: () => string; openSettings: () => void; logFood: (text: string) => void }) {
  const list = h("div", { class: "chat-list", "aria-live": "polite" });
  const input = h("textarea", { class: "chat-input", rows: 1, placeholder: t("chatPlaceholder"), "aria-label": t("chatPlaceholder") });
  input.value = draft;
  const sendBtn = h("button", { class: "chat-send", "aria-label": t("send"), disabled: busy }, "↑");
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };
  input.addEventListener("input", () => {
    draft = input.value;
    grow();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  sendBtn.addEventListener("click", () => send(input.value));
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || busy) return;
    try {
      const p = await prepareImage(file);
      send(input.value, { base64: p.base64, thumb: p.thumb });
    } catch {
      /* unreadable photo */
    }
  });
  const photoBtn = h("button", { class: "chat-photo", "aria-label": t("chatPhoto"), onclick: () => fileInput.click() }, "📷");

  const badge = h("span", { class: "ai-badge" });
  badge.innerHTML = SPARKLE;
  badge.append(t("aiPowered"));

  const header = h(
    "div",
    { class: "chat-head" },
    h("h1", { class: "page-title" }, t("chatTitle")),
    badge,
    h("button", { class: "chat-new", onclick: () => newChat() }, `✏️ ${t("newChat")}`),
  );
  const menuBtn = h("button", { class: "chat-menu-btn", "aria-label": t("chatHistory"), onclick: () => openHistory() }, "☰");
  header.prepend(menuBtn);

  function newChat() {
    if (busy) return;
    archiveCurrent();
    messages = [];
    draft = "";
    input.value = "";
    persist();
    draw();
    window.scrollTo({ top: 0 });
  }

  function openHistory() {
    const close = () => {
      drawer.classList.add("closing");
      setTimeout(() => wrap.remove(), 220);
    };
    const old = history.get();
    const drawer = h(
      "aside",
      { class: "chat-drawer", role: "dialog", "aria-label": t("chatHistory") },
      h("div", { class: "chat-drawer-head" }, h("h2", {}, t("chatHistory")), h("button", { class: "icon-btn", "aria-label": t("close"), onclick: close }, "×")),
      h("button", { class: "btn primary wide", onclick: () => { close(); newChat(); } }, `✏️ ${t("newChat")}`),
      old.length
        ? h(
            "div",
            { class: "chat-old-list" },
            ...old.map((c) =>
              h(
                "div",
                { class: "chat-old" },
                h(
                  "button",
                  {
                    class: "chat-old-open",
                    onclick: () => {
                      if (busy) return;
                      const rest = history.get().filter((x) => x.id !== c.id);
                      history.set(rest);
                      archiveCurrent();
                      messages = c.messages;
                      persist();
                      close();
                      draw();
                    },
                  },
                  h("span", { class: "chat-old-title" }, c.title),
                  h("span", { class: "muted small" }, new Date(c.updated).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })),
                ),
                h("button", { class: "icon-btn remove", "aria-label": t("delete"), onclick: () => { history.set(history.get().filter((x) => x.id !== c.id)); close(); openHistory(); } }, "×"),
              ),
            ),
          )
        : h("p", { class: "muted" }, t("noOldChats")),
      h("p", { class: "muted small" }, t("chatHistoryHint")),
    );
    const wrap = h("div", { class: "chat-drawer-wrap" }, h("div", { class: "chat-drawer-bg", onclick: close }), drawer);
    document.body.append(wrap);
  }

  function draw() {
    list.replaceChildren();
    if (!messages.length) {
      list.append(
        h(
          "div",
          { class: "chat-intro" },
          h("div", { class: "chat-chef", "aria-hidden": "true" }, "🧑‍🍳"),
          h("p", {}, t("chatIntro")),
          h("div", { class: "chat-chips" }, ...(["chatS1", "chatS2", "chatS3", "chatS4", "chatS5"] as StringKey[]).map((k) => h("button", { class: "chip", onclick: () => send(t(k).replace(/^\S+\s/, "")) }, t(k)))),
        ),
      );
    }
    messages.forEach((m, i) => {
      const bubble = h("div", { class: `msg ${m.role === "user" ? "me" : "ai"}${m.error ? " err" : ""}`, style: i === messages.length - 1 ? "" : "animation:none" });
      if (m.role === "user" && m.thumb) bubble.append(h("img", { class: "msg-photo", src: m.thumb, alt: "" }));
      if (m.role === "user" || m.error) bubble.append(m.text);
      else {
        bubble.append(...md(m.text));
        const ingr = ingredientsOf(m.text);
        if (m.log) bubble.append(h("div", { class: "msg-actions" }, h("button", { class: "chip small log-chip", onclick: () => deps.logFood(m.log!) }, `🍽️ ${t("logIt")}: ${m.log}`)));
        const canSave = featureOn("recipes");
        const canShop = featureOn("shopping");
        if (ingr.length >= 3 && (canSave || canShop))
          bubble.append(
            h(
              "div",
              { class: "msg-actions" },
              canSave ? h("button", { class: "chip small", onclick: () => saveRecipe(m.text) }, t("saveRecipe")) : null,
              canShop ? h("button", { class: "chip small", onclick: () => addToShopping(ingr) }, t("addIngredients")) : null,
            ),
          );
      }
      if (m.sources?.length) {
        bubble.append(
          h(
            "div",
            { class: "msg-sources" },
            h("span", { class: "muted small" }, `🌐 ${t("sources")}:`),
            ...m.sources.map((s) => h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", class: "src-chip" }, s.title || new URL(s.url).hostname)),
          ),
        );
      }
      list.append(bubble);
    });
    if (busy) list.append(h("div", { class: "msg ai typing", "aria-label": "…" }, h("i"), h("i"), h("i")));
    sendBtn.disabled = busy;
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
  }

  async function send(text: string, photo?: { base64: string; thumb: string }) {
    let q = text.trim();
    if ((!q && !photo) || busy) return;
    if (!deps.apiKey) return deps.openSettings();
    if (!q && photo) q = t("chatPhotoQ");
    messages = messages.filter((m) => !m.error);
    messages.push({ role: "user", text: q, ...(photo ? { image: photo.base64, thumb: photo.thumb } : {}) });
    draft = "";
    input.value = "";
    grow();
    busy = true;
    persist();
    draw();
    try {
      const reply = await chatAnswer({ apiKey: deps.apiKey, history: messages.map(({ role, text, image }) => ({ role, text, image })), context: deps.context() });
      messages.push({ role: "model", text: reply.text, sources: reply.sources, log: reply.log });
    } catch (err) {
      messages.push({ role: "model", text: err instanceof AnalysisError ? err.message : t("somethingWrong"), error: true });
    } finally {
      busy = false;
      for (const m of messages) delete m.image; // the photo was sent once; keep only the small preview
      persist();
      if (root.isConnected) draw();
    }
  }

  const composer = deps.apiKey
    ? h("div", { class: "chat-composer" }, h("p", { class: "chat-scope muted" }, t("chatOnlyFood")), h("div", { class: "chat-row" }, photoBtn, fileInput, input, sendBtn))
    : h("div", { class: "chat-composer nokey" }, h("p", { class: "muted small" }, t("chatNeedKey")), h("button", { class: "btn primary small", onclick: deps.openSettings }, t("openSettings")));
  root.replaceChildren(header, list, composer);
  draw();
  grow();
}
