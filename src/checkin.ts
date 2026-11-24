// Daily check-in: mood, energy and hunger on a 1–5 scale, with a two-week chart.
import { t, type StringKey } from "./i18n";
import { addDays, localDate, persisted } from "./store";
import { h, toast } from "./ui";
import { locale } from "./i18n";

export interface CheckIn {
  mood?: number;
  energy?: number;
  hunger?: number;
  note?: string;
}
type Metric = "mood" | "energy" | "hunger";

const store = persisted<Record<string, CheckIn>>("fc.checkin.v1", {});
export const checkinFor = (date: string): CheckIn => store.get()[date] ?? {};
export const checkinDays = () => Object.values(store.get()).filter((c) => c.mood || c.energy || c.hunger).length;
export const allCheckins = () => store.get();

export const SCALES: Record<Metric, { title: StringKey; emojis: string[]; color: string }> = {
  mood: { title: "ciMood", emojis: ["😞", "😕", "😐", "🙂", "😄"], color: "#f2b134" },
  energy: { title: "ciEnergy", emojis: ["🪫", "😴", "🙂", "💪", "⚡"], color: "#2f9e5e" },
  hunger: { title: "ciHunger", emojis: ["😌", "🙂", "😐", "😋", "🤤"], color: "#e5484d" },
};

function set(date: string, patch: Partial<CheckIn>) {
  const all = { ...store.get() };
  all[date] = { ...all[date], ...patch };
  store.set(all);
}

function scale(date: string, metric: Metric, onChange: () => void, compact = false): HTMLElement {
  const cur = checkinFor(date)[metric];
  const sc = SCALES[metric];
  return h(
    "div",
    { class: `ci-scale${compact ? " compact" : ""}`, role: "radiogroup", "aria-label": t(sc.title) },
    ...sc.emojis.map((e, i) =>
      h(
        "button",
        {
          class: `ci-opt${cur === i + 1 ? " on" : ""}`,
          role: "radio",
          "aria-checked": String(cur === i + 1),
          "aria-label": `${t(sc.title)} ${i + 1}/5`,
          onclick: () => {
            set(date, { [metric]: i + 1 });
            onChange();
          },
        },
        e,
      ),
    ),
  );
}

/** A small "How are you feeling?" card for Today (only until you've answered). */
export function checkinPrompt(date: string, onChange: () => void): HTMLElement | null {
  if (checkinFor(date).mood) return null;
  return h(
    "section",
    { class: "card ci-prompt" },
    h("h3", {}, t("ciPrompt")),
    scale(date, "mood", () => {
      toast(t("ciThanks"));
      onChange();
    }, true),
  );
}

export function renderCheckin(root: HTMLElement) {
  const today = localDate();
  const draw = () => {
    const c = checkinFor(today);
    const note = h("textarea", { class: "fb-text ci-note", rows: 2, placeholder: t("ciNotePh") }, c.note ?? "");
    note.addEventListener("change", () => set(today, { note: note.value.trim().slice(0, 300) }));
    // two-week chart
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
    const chart = h(
      "div",
      { class: "ci-chart", "aria-hidden": "true" },
      ...days.map((d) => {
        const ci = checkinFor(d);
        return h(
          "div",
          { class: "ci-col" },
          h(
            "div",
            { class: "ci-bars" },
            ...(["mood", "energy", "hunger"] as Metric[]).map((m) => h("span", { class: "ci-bar", style: `height:${((ci[m] ?? 0) / 5) * 100}%;background:${SCALES[m].color}` })),
          ),
          h("span", { class: "ci-day" }, new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { weekday: "narrow" })),
        );
      }),
    );
    const legend = h("div", { class: "ci-legend" }, ...(["mood", "energy", "hunger"] as Metric[]).map((m) => h("span", {}, h("i", { style: `background:${SCALES[m].color}` }), t(SCALES[m].title))));
    root.replaceChildren(
      h("h1", { class: "page-title" }, t("checkin")),
      h(
        "section",
        { class: "card" },
        h("p", { class: "muted small" }, t("ciIntro")),
        ...(["mood", "energy", "hunger"] as Metric[]).flatMap((m) => [h("h3", { class: "ci-title" }, t(SCALES[m].title)), scale(today, m, draw)]),
        h("h3", { class: "ci-title" }, t("ciNote")),
        note,
      ),
      h("section", { class: "card" }, h("h3", {}, t("ciTwoWeeks")), chart, legend),
    );
  };
  draw();
}
