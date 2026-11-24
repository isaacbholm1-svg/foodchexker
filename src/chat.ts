// The food chat tab: an AI that only talks about food, nutrition and recipes.
import { AnalysisError, chatAnswer, type ChatTurn } from "./ai";
import { t, type StringKey } from "./i18n";
import { h } from "./ui";

interface Msg extends ChatTurn {
  sources?: { title: string; url: string }[];
  error?: boolean;
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
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(messages.filter((m) => !m.error).slice(-40)));
  } catch {
    /* ignore */
  }
}

const SPARKLE =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M10 2.5c.45 4.1 2.4 6.05 6.5 6.5-4.1.45-6.05 2.4-6.5 6.5-.45-4.1-2.4-6.05-6.5-6.5 4.1-.45 6.05-2.4 6.5-6.5Z"/><path fill="currentColor" d="M18.5 13.5c.25 2.25 1.25 3.25 3.5 3.5-2.25.25-3.25 1.25-3.5 3.5-.25-2.25-1.25-3.25-3.5-3.5 2.25-.25 3.25-1.25 3.5-3.5Z"/></svg>';

/** Safe mini-markdown: headings, bold, bullet and numbered lists. Text is never parsed as HTML. */
function md(text: string): Node[] {
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

export function renderChat(root: HTMLElement, deps: { apiKey: string; context: () => string; openSettings: () => void }) {
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

  const badge = h("span", { class: "ai-badge" });
  badge.innerHTML = SPARKLE;
  badge.append(t("aiPowered"));

  const header = h(
    "div",
    { class: "chat-head" },
    h("h1", { class: "page-title" }, t("chatTitle")),
    badge,
    messages.length ? h("button", { class: "btn small ghost chat-new", onclick: () => { messages = []; persist(); draw(); } }, t("newChat")) : null,
  );

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
      if (m.role === "user" || m.error) bubble.append(m.text);
      else bubble.append(...md(m.text));
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
    requestAnimationFrame(() => list.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" }));
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (!deps.apiKey) return deps.openSettings();
    messages = messages.filter((m) => !m.error);
    messages.push({ role: "user", text: q });
    draft = "";
    input.value = "";
    grow();
    busy = true;
    persist();
    draw();
    try {
      const reply = await chatAnswer({ apiKey: deps.apiKey, history: messages.map(({ role, text }) => ({ role, text })), context: deps.context() });
      messages.push({ role: "model", text: reply.text, sources: reply.sources });
    } catch (err) {
      messages.push({ role: "model", text: err instanceof AnalysisError ? err.message : t("somethingWrong"), error: true });
    } finally {
      busy = false;
      persist();
      if (root.isConnected) draw();
    }
  }

  const composer = deps.apiKey
    ? h("div", { class: "chat-composer" }, h("p", { class: "chat-scope muted" }, t("chatOnlyFood")), h("div", { class: "chat-row" }, input, sendBtn))
    : h("div", { class: "chat-composer nokey" }, h("p", { class: "muted small" }, t("chatNeedKey")), h("button", { class: "btn primary small", onclick: deps.openSettings }, t("openSettings")));
  root.replaceChildren(header, list, composer);
  draw();
  grow();
}
