// Recipe book (saved from the chat) and shopping list.
import { md } from "./chat";
import { locale, t } from "./i18n";
import { featureOn } from "./features";
import { persisted } from "./store";
import { h, toast } from "./ui";
import { classifyAisles } from "./ai";
import { guessSection, isKnown, layout, rememberSections, SECTION_IDS, SECTIONS, sectionOrder, type Section } from "./aisles";

const SPARKLE =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 2.5c.45 4.1 2.4 6.05 6.5 6.5-4.1.45-6.05 2.4-6.5 6.5-.45-4.1-2.4-6.05-6.5-6.5 4.1-.45 6.05-2.4 6.5-6.5Z"/><path fill="currentColor" d="M18.5 13.5c.25 2.25 1.25 3.25 3.5 3.5-2.25.25-3.25 1.25-3.5 3.5-.25-2.25-1.25-3.25-3.5-3.5 2.25-.25 3.25-1.25 3.5-3.5Z"/></svg>';
let sorting = false;

export interface Recipe {
  id: string;
  title: string;
  text: string;
  created: number;
}
export interface ShopItem {
  id: string;
  text: string;
  done: boolean;
}

const recipes = persisted<Recipe[]>("fc.recipes.v1", []);
const shopping = persisted<ShopItem[]>("fc.shopping.v1", []);

export const recipeCount = () => recipes.get().length;
export const shoppingCount = () => shopping.get().filter((i) => !i.done).length;

/** A title for a recipe: its first heading, else its first bold line, else its first line. */
export function recipeTitle(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.find((l) => /^#{1,4}\s/.test(l));
  if (head) return clean(head.replace(/^#+\s*/, ""));
  const bold = lines.find((l) => /^\*\*[^*]+\*\*$/.test(l));
  return clean(bold ?? lines[0] ?? "Recipe");
}
const clean = (s: string) => s.replace(/\*\*/g, "").replace(/[:：]$/, "").slice(0, 70);

/** Bullet items of the first list in a message (usually the ingredients). */
export function ingredientsOf(text: string): string[] {
  const out: string[] = [];
  let started = false;
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*[-*•]\s+(.*)$/);
    if (m) {
      started = true;
      out.push(m[1].replace(/\*\*/g, "").trim());
    } else if (started && raw.trim()) break;
  }
  return out.filter(Boolean).slice(0, 40);
}

export function saveRecipe(text: string): void {
  recipes.set([{ id: crypto.randomUUID(), title: recipeTitle(text), text, created: Date.now() }, ...recipes.get()]);
  toast(t("recipeSaved"));
}

export function addToShopping(items: string[]): void {
  if (!items.length) return void toast(t("noIngredients"));
  const have = new Set(shopping.get().map((i) => i.text.toLowerCase()));
  const fresh = items.filter((i) => !have.has(i.toLowerCase())).map((text) => ({ id: crypto.randomUUID(), text, done: false }));
  shopping.set([...shopping.get(), ...fresh]);
  toast(t("ingredientsAdded", { n: fresh.length || items.length }));
}

export function renderRecipes(root: HTMLElement, deps: { logText: (text: string) => void; goChat: () => void }) {
  let open: string | null = null;
  const draw = () => {
    const list = recipes.get();
    const r = list.find((x) => x.id === open);
    // Inside a recipe, show only "‹ Recipe book" (not also "‹ More").
    const outerBack = root.parentElement?.querySelector<HTMLElement>(":scope > .subhead");
    if (outerBack) outerBack.hidden = !!r;
    if (r) {
      root.replaceChildren(
        h("button", { class: "back-btn", onclick: () => { open = null; draw(); } }, "‹ ", t("recipes")),
        h("article", { class: "card recipe-card msg ai" }, ...md(r.text)),
        h(
          "div",
          { class: "recipe-actions" },
          h("button", { class: "btn primary", onclick: () => deps.logText(`1 serving of ${r.title}. Recipe:\n${r.text.slice(0, 1500)}`) }, t("logServing")),
          featureOn("shopping") ? h("button", { class: "btn", onclick: () => addToShopping(ingredientsOf(r.text)) }, t("addIngredients")) : null,
          h("button", { class: "btn danger", onclick: () => { if (confirm(t("confirmDeleteRecipe"))) { recipes.set(list.filter((x) => x.id !== r.id)); open = null; draw(); } } }, t("deleteRecipe")),
        ),
      );
      return;
    }
    root.replaceChildren(
      h("h1", { class: "page-title" }, t("recipes")),
      list.length
        ? h(
            "div",
            { class: "recipe-list" },
            ...list.map((x, i) =>
              h(
                "button",
                { class: "card recipe-row", style: `animation-delay:${i * 40}ms`, onclick: () => { open = x.id; draw(); window.scrollTo({ top: 0 }); } },
                h("span", { class: "recipe-emoji", "aria-hidden": "true" }, "📖"),
                h("span", { class: "more-text" }, h("span", { class: "more-title" }, x.title), h("span", { class: "more-desc" }, t("savedOn", { date: new Date(x.created).toLocaleDateString(locale(), { day: "numeric", month: "short" }) }))),
                h("span", { class: "more-chev" }, "›"),
              ),
            ),
          )
        : h("p", { class: "card empty-note" }, t("noRecipes")),
      h("button", { class: "btn wide", onclick: deps.goChat }, t("askChat")),
    );
  };
  draw();
}

export function renderShopping(root: HTMLElement, deps: { apiKey: () => string } = { apiKey: () => "" }) {
  const input = h("input", { type: "text", placeholder: t("shoppingPh"), autocomplete: "off", enterkeyhint: "done" });
  const listBox = h("div", { class: "shop-list" });
  const addItem = () => {
    const v = input.value.trim();
    if (!v) return;
    shopping.set([...shopping.get(), { id: crypto.randomUUID(), text: v, done: false }]);
    input.value = "";
    draw();
    input.focus();
  };
  const form = h("form", { class: "text-form" }, input, h("button", { type: "submit", class: "btn primary" }, t("add")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    addItem();
  });
  const sortBtn = h("button", { class: "ai-sort-btn", "aria-pressed": "false" });
  sortBtn.addEventListener("click", () => {
    const l = layout.get();
    layout.set({ ...l, store: l.store === "off" ? "ksupermarket" : "off" });
    draw();
  });
  // Ask the AI about items the built-in word list doesn't know (once per item).
  const classifyUnknown = async () => {
    const key = deps.apiKey();
    if (!key || sorting || !sectionOrder()) return;
    const unknown = [...new Set(shopping.get().filter((i) => !i.done && !isKnown(i.text) && !guessSection(i.text)).map((i) => i.text))].slice(0, 40);
    if (!unknown.length) return;
    sorting = true;
    draw();
    try {
      const map = await classifyAisles(key, unknown, SECTION_IDS);
      rememberSections(Object.fromEntries(unknown.map((u) => [u, (map[u] as Section) ?? "other"])));
    } catch {
      rememberSections(Object.fromEntries(unknown.map((u) => [u, "other" as Section])));
    } finally {
      sorting = false;
      if (root.isConnected) draw();
    }
  };
  const row = (it: ShopItem) => {
    const cb = h("input", { type: "checkbox", class: "shop-check", checked: it.done, "aria-label": it.text });
    cb.addEventListener("change", () => {
      shopping.set(shopping.get().map((x) => (x.id === it.id ? { ...x, done: cb.checked } : x)));
      setTimeout(draw, 250);
    });
    return h(
      "label",
      { class: `shop-item${it.done ? " done" : ""}` },
      cb,
      h("span", { class: "shop-text" }, it.text),
      h("button", { class: "icon-btn remove", "aria-label": t("delete"), onclick: (e: Event) => { e.preventDefault(); shopping.set(shopping.get().filter((x) => x.id !== it.id)); draw(); } }, "×"),
    );
  };
  const draw = () => {
    const items = shopping.get();
    const order = sectionOrder();
    sortBtn.innerHTML = SPARKLE;
    sortBtn.append(` ${t("aiSort")}${sorting ? " …" : ""}`);
    sortBtn.setAttribute("aria-pressed", String(!!order));
    sortBtn.classList.toggle("on", !!order);
    if (order && items.length) {
      const open = items.filter((i) => !i.done);
      const groups = order
        .map((sec) => ({ sec, list: open.filter((i) => (guessSection(i.text) ?? "other") === sec) }))
        .filter((g) => g.list.length);
      const done = items.filter((i) => i.done);
      listBox.replaceChildren(
        ...groups.flatMap((g) => {
          const info = SECTIONS.find((x) => x.id === g.sec)!;
          return [h("div", { class: "shop-sec" }, `${info.emoji} ${t(info.label)}`), ...g.list.map(row)];
        }),
        ...(done.length ? [h("div", { class: "shop-sec muted" }, "✓"), ...done.map(row)] : []),
      );
      void classifyUnknown();
      return;
    }
    listBox.replaceChildren(
      ...(items.length
        ? items
            .slice()
            .sort((a, b) => Number(a.done) - Number(b.done))
            .map((it) => {
              const cb = h("input", { type: "checkbox", class: "shop-check", checked: it.done, "aria-label": it.text });
              cb.addEventListener("change", () => {
                shopping.set(shopping.get().map((x) => (x.id === it.id ? { ...x, done: cb.checked } : x)));
                setTimeout(draw, 250);
              });
              return h(
                "label",
                { class: `shop-item${it.done ? " done" : ""}` },
                cb,
                h("span", { class: "shop-text" }, it.text),
                h("button", { class: "icon-btn remove", "aria-label": t("delete"), onclick: (e: Event) => { e.preventDefault(); shopping.set(shopping.get().filter((x) => x.id !== it.id)); draw(); } }, "×"),
              );
            })
        : [h("p", { class: "muted" }, t("shoppingEmpty"))]),
    );
  };
  const share = async () => {
    const text = shopping
      .get()
      .filter((i) => !i.done)
      .map((i) => `☐ ${i.text}`)
      .join("\n");
    if (!text) return;
    try {
      if (navigator.share) await navigator.share({ title: t("shopping"), text });
      else {
        await navigator.clipboard.writeText(text);
        toast(t("copied"));
      }
    } catch {
      /* closed */
    }
  };
  root.replaceChildren(
    h("h1", { class: "page-title" }, t("shopping")),
    h("section", { class: "card" }, form, h("div", { class: "shop-tools" }, sortBtn), listBox),
    h(
      "div",
      { class: "recipe-actions" },
      h("button", { class: "btn", onclick: share }, `📤 ${t("shareList")}`),
      h("button", { class: "btn ghost", onclick: () => { shopping.set(shopping.get().filter((i) => !i.done)); draw(); } }, t("clearChecked")),
    ),
  );
  draw();
}
