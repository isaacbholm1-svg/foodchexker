// The "Customize" page: personal look and layout choices.
import { custom, DEFAULT_ORDER, MEAL_EMOJI_DEFAULT, resetCustom, setCustom, type CardId, type Custom, type MealKey } from "./custom";
import { t, type StringKey } from "./i18n";
import { h, segmented, toggle, toast } from "./ui";

const CARD_LABEL: Record<CardId, StringKey> = {
  motivation: "motivationMsgs",
  summary: "card_summary",
  add: "addFood",
  suggestions: "f_suggestions",
  water: "waterTracker",
  exercise: "exercise",
  meals: "card_meals",
  tip: "tipTitle",
};
const CARD_EMOJI: Record<CardId, string> = { motivation: "💪", summary: "⭕", add: "📷", suggestions: "✨", water: "💧", exercise: "🏃", meals: "🍽️", tip: "💡" };
const MEALS: MealKey[] = ["breakfast", "lunch", "dinner", "snack"];

export function renderCustomize(root: HTMLElement, deps: { appearance: () => HTMLElement; cardOn: (id: CardId) => boolean; changed: () => void }) {
  const draw = () => {
    const c = custom();
    const set = (patch: Partial<Custom>) => {
      setCustom(patch);
      deps.changed();
      draw();
    };
    const row = (label: string, control: HTMLElement) => h("div", { class: "unit-row" }, h("span", {}, label), control);
    const card = (title: string, ...kids: (Node | null)[]) => h("section", { class: "card settings-card" }, h("h3", {}, title), ...kids.filter((k): k is Node => !!k));

    const move = (i: number, d: number) => {
      const order = [...c.order];
      [order[i], order[i + d]] = [order[i + d], order[i]];
      set({ order });
    };

    const mealInputs = MEALS.map((m) => {
      const emoji = h("input", { type: "text", class: "meal-emoji-in", value: c.meals[m]?.emoji ?? "", placeholder: MEAL_EMOJI_DEFAULT[m], "aria-label": `${t(m === "snack" ? "snacks" : m)} emoji`, maxlength: 4 });
      const name = h("input", { type: "text", value: c.meals[m]?.name ?? "", placeholder: t(m === "snack" ? "snacks" : m), maxlength: 24, "aria-label": t(m === "snack" ? "snacks" : m) });
      const save = () => setCustom({ meals: { ...custom().meals, [m]: { name: name.value.trim(), emoji: emoji.value.trim() } } });
      emoji.addEventListener("change", () => { save(); deps.changed(); });
      name.addEventListener("change", () => { save(); deps.changed(); });
      return h("div", { class: "meal-name-row" }, emoji, name);
    });

    root.replaceChildren(
      h("h1", { class: "page-title" }, t("customize")),
      deps.appearance(),
      card(
        t("textSize"),
        segmented<Custom["textSize"]>(
          [
            { value: "s", label: "A−" },
            { value: "m", label: "A" },
            { value: "l", label: "A+" },
            { value: "xl", label: "A++" },
          ],
          c.textSize,
          (v) => set({ textSize: v }),
          t("textSize"),
        ),
        toggle(t("pureBlack"), c.black, (v) => set({ black: v }), t("pureBlackHint")),
        toggle(t("compactOpt"), c.compact, (v) => set({ compact: v }), t("compactHint")),
      ),
      card(
        t("todayLayout"),
        row(t("startTab"), segmented<Custom["startTab"]>([{ value: "today", label: t("today") }, { value: "chat", label: t("chat") }, { value: "stats", label: t("progress") }], c.startTab, (v) => set({ startTab: v }), t("startTab"))),
        row(t("ringShows"), segmented<Custom["ring"]>([{ value: "left", label: t("ringLeftOpt") }, { value: "eaten", label: t("ringEatenOpt") }], c.ring, (v) => set({ ring: v }), t("ringShows"))),
        h("div", { class: "field-label" }, t("todayOrder")),
        h("p", { class: "muted small" }, t("todayOrderHint")),
        h(
          "ol",
          { class: "sec-order" },
          ...c.order.map((id, i) =>
            h(
              "li",
              { class: deps.cardOn(id) ? "" : "off" },
              h("span", { class: "sec-name" }, `${CARD_EMOJI[id]} ${t(CARD_LABEL[id])}`),
              h("button", { class: "icon-btn", "aria-label": t("moveUp"), disabled: i === 0, onclick: () => move(i, -1) }, "↑"),
              h("button", { class: "icon-btn", "aria-label": t("moveDown"), disabled: i === c.order.length - 1, onclick: () => move(i, 1) }, "↓"),
            ),
          ),
        ),
        c.order.join() !== DEFAULT_ORDER.join() ? h("button", { class: "btn ghost wide", onclick: () => set({ order: DEFAULT_ORDER }) }, t("resetOrder")) : null,
      ),
      card(t("mealNames"), h("p", { class: "muted small" }, t("mealNamesHint")), ...mealInputs),
      card(
        t("effectsTitle"),
        toggle(t("confettiOpt"), c.confetti, (v) => set({ confetti: v })),
        toggle(t("animationsOpt"), c.motion, (v) => set({ motion: v })),
      ),
      h("button", { class: "btn wide ghost", onclick: () => { if (!confirm(t("resetCustomConfirm"))) return; resetCustom(); deps.changed(); draw(); toast(t("resetDone")); } }, t("resetCustom")),
    );
  };
  draw();
}
