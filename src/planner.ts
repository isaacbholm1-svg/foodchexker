// AI day planner: a whole day of meals that fits your targets.
import { AnalysisError, planDay, type PlannedMeal } from "./ai";
import { featureOn } from "./features";
import { t, type StringKey } from "./i18n";
import { addToShopping } from "./recipes";
import { persisted, type Settings } from "./store";
import { h } from "./ui";

interface Plan {
  created: number;
  meals: PlannedMeal[];
  logged: number[];
}

const planStore = persisted<Plan | null>("fc.plan.v1", null);
const prefsStore = persisted<string>("fc.planprefs.v1", "");
let loading = false;
let error = "";

const MEAL_KEY: Record<PlannedMeal["meal"], StringKey> = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "snack" };

export function renderPlanner(
  root: HTMLElement,
  deps: {
    settings: () => Settings;
    goal: () => string;
    aiBadge: () => HTMLElement;
    log: (m: PlannedMeal) => void;
    openSettings: () => void;
  },
) {
  const draw = () => {
    const s = deps.settings();
    const plan = planStore.get();
    const prefs = h("input", { type: "text", value: prefsStore.get(), placeholder: t("plannerPrefsPh"), autocomplete: "off", "aria-label": t("plannerPrefs") });
    prefs.addEventListener("change", () => prefsStore.set(prefs.value.trim()));

    const generate = async () => {
      if (loading) return;
      prefsStore.set(prefs.value.trim());
      loading = true;
      error = "";
      draw();
      try {
        const tg = s.targets;
        const meals = await planDay({
          apiKey: s.apiKey,
          calories: tg.calories,
          protein: tg.protein,
          carbs: tg.carbs,
          fat: tg.fat,
          goal: deps.goal(),
          age: s.profile?.age,
          prefs: prefsStore.get(),
        });
        planStore.set({ created: Date.now(), meals, logged: [] });
      } catch (e) {
        error = e instanceof AnalysisError ? e.message : t("somethingWrong");
      } finally {
        loading = false;
        if (root.isConnected) draw();
      }
    };

    const top = h(
      "section",
      { class: "card planner-top" },
      h("p", { class: "muted small" }, t("plannerIntro", { kcal: s.targets.calories, p: s.targets.protein })),
      h("label", { class: "field" }, h("span", {}, t("plannerPrefs")), prefs),
      s.apiKey
        ? h("button", { class: "btn primary wide plan-btn", disabled: loading, onclick: generate }, loading ? t("planning") : plan ? t("newPlan") : t("planDay"))
        : h("div", {}, h("p", { class: "muted" }, t("needKey")), h("button", { class: "btn wide", onclick: deps.openSettings }, t("settings"))),
      error ? h("p", { class: "plan-error" }, error) : null,
    );

    let body: HTMLElement | null = null;
    if (loading) {
      body = h(
        "div",
        { class: "plan-loading" },
        h("div", { class: "plan-chef", "aria-hidden": "true" }, "🧑‍🍳"),
        h("p", {}, t("planning")),
        h("div", { class: "an-dots" }, h("i"), h("i"), h("i")),
        ...[0, 1, 2].map(() => h("div", { class: "card plan-sk" }, h("span", { class: "sk", style: "width:40%;height:12px" }), h("span", { class: "sk", style: "width:75%;height:16px;margin-top:10px" }), h("span", { class: "sk", style: "width:55%;height:12px;margin-top:10px" }))),
      );
    } else if (plan) {
      const tot = plan.meals.reduce((a, m) => ({ kcal: a.kcal + m.calories, p: a.p + m.protein_g }), { kcal: 0, p: 0 });
      const allIngredients = plan.meals.flatMap((m) => m.ingredients);
      body = h(
        "div",
        { class: "plan-list" },
        h("div", { class: "plan-total" }, h("span", {}, t("planTotal", { kcal: tot.kcal, p: tot.p })), deps.aiBadge()),
        ...plan.meals.map((m, i) => {
          const done = plan.logged.includes(i);
          return h(
            "article",
            { class: `card plan-meal${done ? " done" : ""}`, style: `animation-delay:${i * 70}ms` },
            h("div", { class: "plan-meal-head" }, h("span", { class: "plan-emoji", "aria-hidden": "true" }, m.emoji), h("span", { class: "plan-when" }, t(MEAL_KEY[m.meal])), h("span", { class: "pm-kcal" }, `${m.calories} kcal`)),
            h("h3", { class: "plan-title" }, m.title),
            h("p", { class: "muted small plan-detail" }, `${m.portion} · ${m.detail}`),
            h("p", { class: "plan-macros small" }, `${t("protein")} ${m.protein_g} g · ${t("carbs")} ${m.carbs_g} g · ${t("fat")} ${m.fat_g} g`),
            m.ingredients.length ? h("details", { class: "plan-ingr" }, h("summary", {}, t("ingredients")), h("ul", {}, ...m.ingredients.map((x) => h("li", {}, x)))) : null,
            h(
              "button",
              {
                class: `btn small ${done ? "ghost" : "primary"} plan-log`,
                onclick: () => {
                  deps.log(m);
                  const p = planStore.get();
                  if (p && !p.logged.includes(i)) planStore.set({ ...p, logged: [...p.logged, i] });
                },
              },
              done ? t("loggedCheck") : t("logThis"),
            ),
          );
        }),
        featureOn("shopping") && allIngredients.length ? h("button", { class: "btn wide", onclick: () => addToShopping(allIngredients) }, t("addAllIngredients")) : null,
        h("p", { class: "footer-note" }, t("aiDisclaimer")),
      );
    } else {
      body = h("div", { class: "plan-empty" }, h("div", { class: "plan-chef", "aria-hidden": "true" }, "🗓️"), h("p", { class: "muted" }, t("plannerEmpty")));
    }
    root.replaceChildren(h("h1", { class: "page-title" }, t("planner")), top, body);
  };
  draw();
}
