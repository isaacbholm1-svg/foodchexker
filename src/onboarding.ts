import { LANGUAGES, getLanguage, locale, setLanguage, t, type Lang } from "./i18n";
import { EXERCISE_EXTRA, GOALS, GOAL_EMOJI, INTENSITIES, KG_PER_LB, MOVEMENTS, exerciseLabel, intensityLabel, migrateActivity, movementDesc, movementLabel, bmi, fmtEnergy, fmtNum, fmtWater, fmtWeight, goalAllowed, goalDesc, goalEta, goalLabel, makePlan, paceOptions, weightToKg, weightValue } from "./nutrition";
import type { Goal, Intensity, Movement, Profile, Sex, Units } from "./store";
import { h, hideToast, segmented, toast } from "./ui";

export interface OnboardingResult {
  profile: Profile;
  units: Units;
  apiKey: string;
}

/** Full-screen setup wizard. Used on first launch and for "Edit profile". */
export function runOnboarding(opts: {
  profile: Profile | null;
  units: Units;
  apiKey: string;
  firstRun: boolean;
  onDone: (r: OnboardingResult) => void;
  onCancel?: () => void;
  onLanguage?: (lang: Lang) => void;
}) {
  const p: Profile = opts.profile
    ? { ...opts.profile }
    : { name: "", sex: "female", age: 0, heightCm: 0, weightKg: 0, activity: "light", movement: "desk", exercise: 1, intensity: "moderate", goal: "maintain", paceKgPerWeek: 0.5 };
  if (!p.movement) Object.assign(p, migrateActivity(p.activity)); // older profiles
  const units: Units = { ...opts.units };
  let apiKey = opts.apiKey;

  const overlay = h("div", { class: "onboard", role: "dialog", "aria-modal": "true", "aria-label": t("setUp") });
  const body = h("div", { class: "ob-body" });
  const dots = h("div", { class: "ob-dots", "aria-hidden": "true" });
  const back = h("button", { type: "button", class: "icon-btn ob-back", "aria-label": t("back") }, "‹");
  const next = h("button", { type: "button", class: "btn primary ob-next" }, t("next"));
  overlay.append(h("div", { class: "ob-top" }, back, dots, opts.firstRun ? h("span", { class: "ob-spacer" }) : h("button", { type: "button", class: "icon-btn", "aria-label": t("close"), onclick: () => close(true) }, "×")), body, h("div", { class: "ob-bottom" }, next));
  document.body.append(overlay);
  document.body.classList.add("no-scroll");

  type Step = { render: () => (Node | null)[]; valid?: () => string | null; nextLabel?: () => string };

  const field = (label: string, input: HTMLElement, suffix?: string) =>
    h("label", { class: "field" }, h("span", {}, label), suffix ? h("div", { class: "with-suffix" }, input, h("span", { class: "suffix" }, suffix)) : input);

  const numInput = (value: number | undefined, onInput: (v: number) => void, attrs: Record<string, unknown> = {}) => {
    const el = h("input", { type: "number", inputmode: "decimal", value: value ? String(value) : "", ...attrs });
    el.addEventListener("input", () => onInput(parseFloat(el.value)));
    return el;
  };

  const choiceCards = <T extends string>(items: { value: T; title: string; desc?: string; emoji?: string; disabled?: string }[], current: T, onPick: (v: T) => void) => {
    const wrap = h("div", { class: "cards", role: "radiogroup" });
    for (const it of items) {
      const b = h(
        "button",
        { type: "button", class: "choice", role: "radio", "aria-checked": String(it.value === current), disabled: !!it.disabled },
        it.emoji ? h("span", { class: "choice-emoji" }, it.emoji) : null,
        h("span", { class: "choice-text" }, h("span", { class: "choice-title" }, it.title), it.desc ? h("span", { class: "choice-desc" }, it.disabled || it.desc) : null),
      );
      b.addEventListener("click", () => {
        wrap.querySelectorAll(".choice").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        onPick(it.value);
      });
      wrap.append(b);
    }
    return wrap;
  };

  const steps: Step[] = [];

  if (opts.firstRun) {
    steps.push({
      nextLabel: () => t("letsGo"),
      render: () => [
        h(
          "div",
          { class: "lang-pick", role: "radiogroup", "aria-label": t("language") },
          ...LANGUAGES.map((l) =>
            h(
              "button",
              {
                type: "button",
                class: "lang-chip",
                role: "radio",
                "aria-checked": String(getLanguage() === l.code),
                onclick: () => {
                  setLanguage(l.code);
                  opts.onLanguage?.(l.code);
                  show();
                },
              },
              `${l.flag} ${l.name}`,
            ),
          ),
        ),
        h("div", { class: "ob-hero" }, "🥗"),
        h("h1", {}, t("welcomeTitle")),
        h("p", { class: "lead" }, t("welcomeLead")),
        h("ul", { class: "ob-list" }, h("li", {}, t("welcome1")), h("li", {}, t("welcome2")), h("li", {}, t("welcome3")), h("li", {}, t("welcome4"))),
        h("p", { class: "muted small" }, t("welcomeTime")),
      ],
    });
  }

  steps.push({
    valid: () => (p.name.trim() ? null : t("nameRequired")),
    render: () => {
      const input = h("input", { type: "text", value: p.name, placeholder: t("namePlaceholder"), autocomplete: "given-name", maxlength: 30 });
      input.addEventListener("input", () => (p.name = input.value));
      setTimeout(() => input.focus(), 50);
      return [h("h2", {}, t("nameTitle")), h("p", { class: "muted" }, t("nameDesc")), field(t("name"), input)];
    },
  });

  steps.push({
    valid: () => (p.age >= 2 && p.age <= 110 ? null : t("ageRequired")),
    render: () => [
      h("h2", {}, t("aboutYou")),
      h("p", { class: "muted" }, t("aboutYouDesc")),
      field(t("age"), numInput(p.age, (v) => (p.age = Math.round(v || 0)), { inputmode: "numeric", min: 2, max: 110 }), t("years")),
      h("div", { class: "field" }, h("span", {}, t("sex")), segmented<Sex>([{ value: "female", label: t("female") }, { value: "male", label: t("male") }, { value: "other", label: t("other") }], p.sex, (v) => (p.sex = v), t("sex"))),
      h("p", { class: "muted small" }, t("otherNote")),
    ],
  });

  steps.push({
    valid: () => {
      if (!(p.heightCm >= 50 && p.heightCm <= 250)) return t("invalidHeight");
      if (!(p.weightKg >= 10 && p.weightKg <= 300)) return t("invalidWeight");
      return null;
    },
    render: () => {
      const box = h("div", { class: "stack" });
      const draw = () => {
        let heightField: HTMLElement;
        if (units.height === "cm") {
          heightField = field(t("height"), numInput(p.heightCm ? Math.round(p.heightCm) : undefined, (v) => (p.heightCm = v || 0), { inputmode: "numeric" }), "cm");
        } else {
          const totalIn = p.heightCm ? Math.round(p.heightCm / 2.54) : 0;
          let ft = totalIn ? Math.floor(totalIn / 12) : 0;
          let inch = totalIn ? totalIn % 12 : 0;
          const upd = () => (p.heightCm = (ft * 12 + inch) * 2.54);
          heightField = h(
            "div",
            { class: "field" },
            h("span", {}, t("height")),
            h(
              "div",
              { class: "field-row" },
              h("div", { class: "with-suffix" }, numInput(ft || undefined, (v) => { ft = v || 0; upd(); }, { inputmode: "numeric" }), h("span", { class: "suffix" }, "ft")),
              h("div", { class: "with-suffix" }, numInput(totalIn ? inch : undefined, (v) => { inch = v || 0; upd(); }, { inputmode: "numeric" }), h("span", { class: "suffix" }, "in")),
            ),
          );
        }
        const w = p.weightKg ? Math.round(weightValue(p.weightKg, units) * 10) / 10 : undefined;
        box.replaceChildren(
          h(
            "div",
            { class: "field" },
            h("span", {}, t("units")),
            segmented(
              [
                { value: "metric", label: t("metric") },
                { value: "imperial", label: t("imperial") },
              ],
              units.weight === "kg" ? "metric" : "imperial",
              (v) => {
                units.weight = v === "metric" ? "kg" : "lb";
                units.height = v === "metric" ? "cm" : "ftin";
                units.water = v === "metric" ? "ml" : "floz";
                draw();
              },
              t("units"),
            ),
          ),
          heightField,
          field(t("currentWeight"), numInput(w, (v) => (p.weightKg = weightToKg(v || 0, units))), units.weight),
        );
      };
      draw();
      return [h("h2", {}, t("bodyTitle")), h("p", { class: "muted" }, t("bodyDesc")), box];
    },
  });

  steps.push({
    render: () => [
      h("h2", {}, t("movementTitle")),
      h("p", { class: "muted" }, t("movementDesc")),
      choiceCards<Movement>(
        MOVEMENTS.map((k) => ({ value: k, title: movementLabel(k), desc: movementDesc(k), emoji: { desk: "🪑", light: "🚶", onfeet: "🧍", physical: "🏗️" }[k] })),
        p.movement!,
        (v) => (p.movement = v),
      ),
    ],
  });

  steps.push({
    render: () => {
      const intensityBox = h("div", { class: "stack" });
      const drawIntensity = () =>
        intensityBox.replaceChildren(
          ...(p.exercise
            ? [
                h("h3", { class: "ob-sub" }, t("intensityTitle")),
                choiceCards<Intensity>(
                  INTENSITIES.map((k) => ({ value: k, title: intensityLabel(k), emoji: { light: "🧘", moderate: "🏋️", hard: "🔥" }[k] })),
                  p.intensity ?? "moderate",
                  (v) => (p.intensity = v),
                ),
              ]
            : []),
        );
      drawIntensity();
      return [
        h("h2", {}, t("exerciseTitle")),
        h("p", { class: "muted" }, t("exerciseDesc")),
        h(
          "div",
          { class: "ex-pick", role: "radiogroup", "aria-label": t("exerciseTitle") },
          ...EXERCISE_EXTRA.map((_, n) => {
            const b = h("button", { type: "button", class: "lang-chip", role: "radio", "aria-checked": String((p.exercise ?? 0) === n) }, exerciseLabel(n));
            b.addEventListener("click", () => {
              p.exercise = n;
              b.parentElement!.querySelectorAll(".lang-chip").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
              drawIntensity();
            });
            return b;
          }),
        ),
        intensityBox,
      ];
    },
  });

  steps.push({
    valid: () => {
      const chk = goalAllowed(p, p.goal);
      if (!chk.allowed) return chk.reason!;
      if (p.goalWeightKg) {
        if (p.goal === "lose" && p.goalWeightKg >= p.weightKg) return t("goalBelow");
        if (p.goal === "gain" && p.goalWeightKg <= p.weightKg) return t("goalAbove");
        const gb = bmi({ heightCm: p.heightCm, weightKg: p.goalWeightKg });
        if (p.goal === "lose" && gb < 18.5) {
          const minKg = 18.5 * (p.heightCm / 100) ** 2;
          return t("goalUnderweight", { min: fmtWeight(minKg, units) });
        }
      }
      return null;
    },
    render: () => {
      const extra = h("div", { class: "stack" });
      const drawExtra = () => {
        const paces = paceOptions(p.goal);
        if (!paces.length) {
          extra.replaceChildren();
          return;
        }
        if (!paces.some((x) => x.kg === p.paceKgPerWeek)) p.paceKgPerWeek = paces.find((x) => x.recommended)!.kg;
        const gw = p.goalWeightKg ? Math.round(weightValue(p.goalWeightKg, units) * 10) / 10 : undefined;
        extra.replaceChildren(
          h(
            "div",
            { class: "field" },
            h("span", {}, t("pacePerWeek")),
            segmented(
              paces.map((x) => ({ value: String(x.kg), label: `${fmtNum(units.weight === "kg" ? x.kg : Math.round((x.kg / KG_PER_LB) * 10) / 10, units.weight === "kg" ? 2 : 1).replace(/[.,]?0+$/, "")} ${units.weight}` })),
              String(p.paceKgPerWeek),
              (v) => (p.paceKgPerWeek = Number(v)),
              t("pacePerWeek"),
            ),
            h("small", { class: "muted" }, paces.map((x) => `${fmtNum(units.weight === "kg" ? x.kg : Math.round((x.kg / KG_PER_LB) * 10) / 10, units.weight === "kg" ? 2 : 1).replace(/[.,]?0+$/, "")}: ${x.label}`).join(" · ")),
          ),
          field(t("goalWeightOptional"), numInput(gw, (v) => (p.goalWeightKg = v ? weightToKg(v, units) : undefined)), units.weight),
        );
      };
      drawExtra();
      return [
        h("h2", {}, t("goalTitle")),
        choiceCards<Goal>(
          GOALS.map((k) => {
            const chk = goalAllowed(p, k);
            return { value: k, title: goalLabel(k), desc: goalDesc(k), emoji: GOAL_EMOJI[k], disabled: chk.allowed ? undefined : chk.reason };
          }),
          p.goal,
          (v) => {
            p.goal = v;
            if (v !== "lose" && v !== "gain") p.goalWeightKg = undefined;
            drawExtra();
          },
        ),
        extra,
      ];
    },
  });

  steps.push({
    nextLabel: () => t("looksGood"),
    render: () => {
      const plan = makePlan(p);
      const tg = plan.targets;
      const eta = goalEta(p);
      const B = bmi(p);
      return [
        h("h2", {}, t("planTitle", { name: p.name.trim() })),
        h(
          "div",
          { class: "plan-hero" },
          h("div", { class: "plan-kcal" }, fmtEnergy(tg.calories, units, false)),
          h("div", { class: "muted" }, t("perDayGoal", { unit: units.energy, goal: goalLabel(p.goal).toLowerCase() })),
        ),
        h(
          "div",
          { class: "plan-grid" },
          tile(t("protein"), `${tg.protein} g`, "protein"),
          tile(t("carbs"), `${tg.carbs} g`, "carbs"),
          tile(t("fat"), `${tg.fat} g`, "fat"),
          tile(t("fiber"), `${tg.fiber} g`),
          tile(t("water"), fmtWater(tg.waterMl, units)),
          p.age >= 18 ? tile(t("bmi"), fmtNum(B, 1)) : tile(t("maintenance"), fmtEnergy(plan.tdee, units)),
        ),
        eta ? h("p", { class: "plan-eta" }, t("eta", { weight: fmtWeight(p.goalWeightKg!, units), date: eta.toLocaleDateString(locale(), { month: "long", year: "numeric" }) })) : null,
        ...plan.notes.map((n) => h("p", { class: "plan-note" }, "⚠️ ", n)),
        h(
          "details",
          { class: "why" },
          h("summary", {}, t("howNumbers")),
          ...plan.why.map((w) => h("div", { class: "why-item" }, h("strong", {}, w.title), h("p", {}, w.text))),
          h("p", { class: "muted small" }, t("planDisclaimer")),
        ),
        h("p", { class: "muted small" }, t("changeLater")),
      ];
    },
  });

  steps.push({
    nextLabel: () => opts.firstRun ? t("startTracking") : t("save"),
    render: () => {
      const input = h("input", { type: "password", value: apiKey, placeholder: "AIza...", autocomplete: "off" });
      input.addEventListener("input", () => (apiKey = input.value.trim()));
      return [
        h("h2", {}, t("keyTitle")),
        h("p", { class: "muted" }, t("keyDesc")),
        h(
          "ol",
          { class: "ob-steps" },
          h("li", {}, `${t("keyStep1a")} `, h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "aistudio.google.com/apikey"), ` ${t("keyStep1b")}`),
          h("li", {}, `${t("keyStep2a")} `, h("strong", {}, t("keyStep2b")), ` ${t("keyStep2c")}`),
          h("li", {}, t("keyStep3")),
        ),
        field(t("aiKey"), input),
        h("p", { class: "muted small" }, t("keyPrivacy")),
      ];
    },
  });

  let i = 0;
  function show() {
    hideToast();
    const st = steps[i];
    body.replaceChildren(...st.render().filter((n): n is Node => n !== null));
    body.scrollTop = 0;
    next.textContent = st.nextLabel?.() ?? t("next");
    back.style.visibility = i === 0 ? "hidden" : "visible";
    dots.replaceChildren(...steps.map((_, j) => h("span", { class: j === i ? "dot on" : j < i ? "dot done" : "dot" })));
  }

  function close(cancelled: boolean) {
    overlay.remove();
    document.body.classList.remove("no-scroll");
    if (cancelled) opts.onCancel?.();
  }

  next.addEventListener("click", () => {
    const err = steps[i].valid?.();
    if (err) {
      toast(err, 5000);
      return;
    }
    if (i < steps.length - 1) {
      i++;
      show();
      return;
    }
    p.name = p.name.trim();
    close(false);
    opts.onDone({ profile: p, units, apiKey });
  });
  back.addEventListener("click", () => {
    if (i > 0) {
      i--;
      show();
    }
  });
  show();
}

function tile(label: string, value: string, macro?: string) {
  return h("div", { class: `plan-tile${macro ? " m-" + macro : ""}` }, h("div", { class: "muted small" }, label), h("div", { class: "plan-val" }, value));
}
