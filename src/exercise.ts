// Exercise log with calorie estimates from MET values (Compendium of Physical Activities).
import { t, type StringKey } from "./i18n";
import { fmtEnergy } from "./nutrition";
import { localDate, persisted, type Units } from "./store";
import { h, toast, toggle } from "./ui";

export interface Workout {
  id: string;
  date: string;
  kind: string;
  minutes: number;
  kcal: number; // extra calories burned (above resting)
}

export const SPORTS: { id: string; emoji: string; met: number }[] = [
  { id: "walk", emoji: "🚶", met: 3.5 },
  { id: "run", emoji: "🏃", met: 9.8 },
  { id: "bike", emoji: "🚴", met: 7.5 },
  { id: "gym", emoji: "🏋️", met: 5 },
  { id: "swim", emoji: "🏊", met: 7 },
  { id: "football", emoji: "⚽", met: 7 },
  { id: "dance", emoji: "💃", met: 5.5 },
  { id: "yoga", emoji: "🧘", met: 2.8 },
  { id: "hike", emoji: "🥾", met: 6 },
  { id: "ski", emoji: "⛷️", met: 7 },
  { id: "hiit", emoji: "🔥", met: 8 },
  { id: "other", emoji: "🤸", met: 5 },
];
const sportName = (id: string) => t(`sport_${id}` as StringKey);

const store = persisted<Workout[]>("fc.exercise.v1", []);
const budget = persisted<boolean>("fc.exbudget.v1", false);

export const workoutsOn = (date: string) => store.get().filter((w) => w.date === date);
export const burnedOn = (date: string) => workoutsOn(date).reduce((a, w) => a + w.kcal, 0);
export const allWorkouts = () => store.get();
/** Extra calories to add to the day's budget (only when the person turned it on). */
export const budgetBonus = (date: string) => (budget.get() ? burnedOn(date) : 0);

/** Net extra kcal: (MET − 1) × kg × hours, so the resting part isn't counted twice. */
export function estimate(sportId: string, minutes: number, kg: number): number {
  const met = SPORTS.find((s) => s.id === sportId)?.met ?? 5;
  return Math.max(0, Math.round((met - 1) * kg * (minutes / 60)));
}

export function renderExercise(root: HTMLElement, deps: { weightKg: () => number; units: () => Units; onChange: () => void }) {
  let sport = "walk";
  let minutes = 30;
  const draw = () => {
    const u = deps.units();
    const today = localDate();
    const est = h("div", { class: "ex-est" });
    const updateEst = () => (est.textContent = `≈ ${fmtEnergy(estimate(sport, minutes, deps.weightKg()), u)}`);
    const minInput = h("input", { type: "number", inputmode: "numeric", min: 1, max: 600, value: minutes, class: "ex-min", "aria-label": t("minutes") });
    minInput.addEventListener("input", () => {
      minutes = Math.min(600, Math.max(0, Number(minInput.value) || 0));
      updateEst();
    });
    updateEst();
    const chips = h(
      "div",
      { class: "ex-sports", role: "radiogroup", "aria-label": t("exercise") },
      ...SPORTS.map((s) =>
        h(
          "button",
          {
            class: `ex-sport${s.id === sport ? " on" : ""}`,
            role: "radio",
            "aria-checked": String(s.id === sport),
            onclick: () => {
              sport = s.id;
              for (const c of chips.children) c.classList.toggle("on", c === chips.children[SPORTS.indexOf(s)]);
              updateEst();
            },
          },
          h("span", { class: "ex-emoji", "aria-hidden": "true" }, s.emoji),
          h("span", {}, sportName(s.id)),
        ),
      ),
    );
    const quick = h(
      "div",
      { class: "chips ex-quick" },
      ...[15, 30, 45, 60, 90].map((m) => h("button", { class: "chip", onclick: () => { minutes = m; minInput.value = String(m); updateEst(); } }, `${m} min`)),
    );
    const logIt = () => {
      if (minutes < 1) return minInput.focus();
      const kcal = estimate(sport, minutes, deps.weightKg());
      store.set([...store.get(), { id: crypto.randomUUID(), date: today, kind: sport, minutes, kcal }]);
      toast(t("exerciseLogged", { kcal: fmtEnergy(kcal, u) }));
      deps.onChange();
      draw();
    };
    const list = workoutsOn(today);
    const weekFrom = localDate(new Date(Date.now() - 6 * 86400000));
    const week = store.get().filter((w) => w.date >= weekFrom);
    const weekMin = week.reduce((a, w) => a + w.minutes, 0);
    root.replaceChildren(
      h("h1", { class: "page-title" }, t("exercise")),
      h(
        "section",
        { class: "card" },
        h("h3", {}, t("whatDidYouDo")),
        chips,
        h("div", { class: "ex-row" }, h("label", { class: "field" }, h("span", {}, t("minutes")), minInput), est),
        quick,
        h("button", { class: "btn primary wide", onclick: logIt }, t("logExercise")),
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, t("today")),
        list.length
          ? h(
              "div",
              { class: "ex-list" },
              ...list.map((w) =>
                h(
                  "div",
                  { class: "ex-item" },
                  h("span", { class: "ex-emoji", "aria-hidden": "true" }, SPORTS.find((s) => s.id === w.kind)?.emoji ?? "🤸"),
                  h("span", { class: "ex-name" }, `${sportName(w.kind)} · ${w.minutes} min`),
                  h("span", { class: "ex-kcal" }, fmtEnergy(w.kcal, u)),
                  h("button", { class: "icon-btn remove", "aria-label": t("delete"), onclick: () => { store.set(store.get().filter((x) => x.id !== w.id)); deps.onChange(); draw(); } }, "×"),
                ),
              ),
            )
          : h("p", { class: "muted" }, t("noExerciseYet")),
        h("p", { class: "muted small ex-week" }, t("exerciseWeek", { min: weekMin, n: week.length })),
      ),
      h(
        "section",
        { class: "card settings-card" },
        toggle(t("addBurned"), budget.get(), (v) => { budget.set(v); deps.onChange(); }, t("addBurnedHint")),
      ),
      h("p", { class: "footer-note" }, t("exerciseNote")),
    );
  };
  draw();
}
