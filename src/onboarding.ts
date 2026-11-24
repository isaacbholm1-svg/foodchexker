import { ACTIVITY, GOALS, KG_PER_LB, bmi, fmtEnergy, fmtWater, fmtWeight, goalAllowed, goalEta, makePlan, paceOptions, weightToKg, weightValue } from "./nutrition";
import type { Activity, Goal, Profile, Sex, Units } from "./store";
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
}) {
  const p: Profile = opts.profile
    ? { ...opts.profile }
    : { name: "", sex: "female", age: 0, heightCm: 0, weightKg: 0, activity: "light", goal: "maintain", paceKgPerWeek: 0.5 };
  const units: Units = { ...opts.units };
  let apiKey = opts.apiKey;

  const overlay = h("div", { class: "onboard", role: "dialog", "aria-modal": "true", "aria-label": "Set up" });
  const body = h("div", { class: "ob-body" });
  const dots = h("div", { class: "ob-dots", "aria-hidden": "true" });
  const back = h("button", { type: "button", class: "icon-btn ob-back", "aria-label": "Back" }, "‹");
  const next = h("button", { type: "button", class: "btn primary ob-next" }, "Next");
  overlay.append(h("div", { class: "ob-top" }, back, dots, opts.firstRun ? h("span", { class: "ob-spacer" }) : h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close(true) }, "×")), body, h("div", { class: "ob-bottom" }, next));
  document.body.append(overlay);
  document.body.classList.add("no-scroll");

  type Step = { render: () => (Node | null)[]; valid?: () => string | null; nextLabel?: string };

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
      nextLabel: "Let's go",
      render: () => [
        h("div", { class: "ob-hero" }, "🥗"),
        h("h1", {}, "Welcome to FoodChexker"),
        h("p", { class: "lead" }, "Snap a photo of your food and free AI counts the calories for you."),
        h(
          "ul",
          { class: "ob-list" },
          h("li", {}, "📸 Photo or text → calories and macros"),
          h("li", {}, "🎯 Personal targets from your body and goal"),
          h("li", {}, "📊 Daily, weekly and yearly progress"),
          h("li", {}, "🔒 Everything stays on your phone"),
        ),
        h("p", { class: "muted small" }, "Setup takes about a minute."),
      ],
    });
  }

  steps.push({
    valid: () => (p.name.trim() ? null : "Please enter your name."),
    render: () => {
      const input = h("input", { type: "text", value: p.name, placeholder: "Your first name", autocomplete: "given-name", maxlength: 30 });
      input.addEventListener("input", () => (p.name = input.value));
      setTimeout(() => input.focus(), 50);
      return [h("h2", {}, "What should we call you?"), h("p", { class: "muted" }, "Used for your daily motivation messages."), field("Name", input)];
    },
  });

  steps.push({
    valid: () => (p.age >= 13 && p.age <= 100 ? null : p.age > 0 && p.age < 13 ? "FoodChexker is for ages 13 and up." : "Please enter your age."),
    render: () => [
      h("h2", {}, "About you"),
      h("p", { class: "muted" }, "Your age and sex change how many calories your body burns."),
      field("Age", numInput(p.age, (v) => (p.age = Math.round(v || 0)), { inputmode: "numeric", min: 13, max: 100 }), "years"),
      h("div", { class: "field" }, h("span", {}, "Sex"), segmented<Sex>([{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other" }], p.sex, (v) => (p.sex = v), "Sex")),
      h("p", { class: "muted small" }, "“Other” uses a value halfway between the male and female formulas."),
    ],
  });

  steps.push({
    valid: () => {
      if (!(p.heightCm >= 100 && p.heightCm <= 250)) return "Please enter a valid height.";
      if (!(p.weightKg >= 30 && p.weightKg <= 300)) return "Please enter a valid weight.";
      return null;
    },
    render: () => {
      const box = h("div", { class: "stack" });
      const draw = () => {
        let heightField: HTMLElement;
        if (units.height === "cm") {
          heightField = field("Height", numInput(p.heightCm ? Math.round(p.heightCm) : undefined, (v) => (p.heightCm = v || 0), { inputmode: "numeric" }), "cm");
        } else {
          const totalIn = p.heightCm ? Math.round(p.heightCm / 2.54) : 0;
          let ft = totalIn ? Math.floor(totalIn / 12) : 0;
          let inch = totalIn ? totalIn % 12 : 0;
          const upd = () => (p.heightCm = (ft * 12 + inch) * 2.54);
          heightField = h(
            "div",
            { class: "field" },
            h("span", {}, "Height"),
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
            h("span", {}, "Units"),
            segmented(
              [
                { value: "metric", label: "Metric (kg, cm)" },
                { value: "imperial", label: "US (lb, ft)" },
              ],
              units.weight === "kg" ? "metric" : "imperial",
              (v) => {
                units.weight = v === "metric" ? "kg" : "lb";
                units.height = v === "metric" ? "cm" : "ftin";
                units.water = v === "metric" ? "ml" : "floz";
                draw();
              },
              "Units",
            ),
          ),
          heightField,
          field("Current weight", numInput(w, (v) => (p.weightKg = weightToKg(v || 0, units))), units.weight),
        );
      };
      draw();
      return [h("h2", {}, "Height and weight"), h("p", { class: "muted" }, "You can change units any time in Settings."), box];
    },
  });

  steps.push({
    render: () => [
      h("h2", {}, "How active are you?"),
      h("p", { class: "muted" }, "Count exercise, sports and how much you move during the day."),
      choiceCards<Activity>(
        (Object.keys(ACTIVITY) as Activity[]).map((k) => ({ value: k, title: ACTIVITY[k].label, desc: ACTIVITY[k].desc })),
        p.activity,
        (v) => (p.activity = v),
      ),
    ],
  });

  steps.push({
    valid: () => {
      const chk = goalAllowed(p, p.goal);
      if (!chk.allowed) return chk.reason!;
      if (p.goalWeightKg) {
        if (p.goal === "lose" && p.goalWeightKg >= p.weightKg) return "Your goal weight should be below your current weight.";
        if (p.goal === "gain" && p.goalWeightKg <= p.weightKg) return "Your goal weight should be above your current weight.";
        const gb = bmi({ heightCm: p.heightCm, weightKg: p.goalWeightKg });
        if (p.goal === "lose" && gb < 18.5) {
          const minKg = 18.5 * (p.heightCm / 100) ** 2;
          return `That goal is underweight for your height. Pick ${fmtWeight(minKg, units)} or more.`;
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
        if (!paces.some((x) => x.kg === p.paceKgPerWeek)) p.paceKgPerWeek = paces.find((x) => x.label.includes("recommended"))!.kg;
        const gw = p.goalWeightKg ? Math.round(weightValue(p.goalWeightKg, units) * 10) / 10 : undefined;
        extra.replaceChildren(
          h(
            "div",
            { class: "field" },
            h("span", {}, "Pace per week"),
            segmented(
              paces.map((x) => ({ value: String(x.kg), label: `${units.weight === "kg" ? x.kg : Math.round((x.kg / KG_PER_LB) * 10) / 10} ${units.weight}` })),
              String(p.paceKgPerWeek),
              (v) => (p.paceKgPerWeek = Number(v)),
              "Pace",
            ),
            h("small", { class: "muted" }, paces.map((x) => `${units.weight === "kg" ? x.kg : Math.round((x.kg / KG_PER_LB) * 10) / 10}: ${x.label}`).join(" · ")),
          ),
          field("Goal weight (optional)", numInput(gw, (v) => (p.goalWeightKg = v ? weightToKg(v, units) : undefined)), units.weight),
        );
      };
      drawExtra();
      return [
        h("h2", {}, "What's your goal?"),
        choiceCards<Goal>(
          (Object.keys(GOALS) as Goal[]).map((k) => {
            const chk = goalAllowed(p, k);
            return { value: k, title: GOALS[k].label, desc: GOALS[k].desc, emoji: GOALS[k].emoji, disabled: chk.allowed ? undefined : chk.reason };
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
    nextLabel: "Looks good",
    render: () => {
      const plan = makePlan(p);
      const t = plan.targets;
      const eta = goalEta(p);
      const B = bmi(p);
      return [
        h("h2", {}, `Your plan, ${p.name.trim()}`),
        h(
          "div",
          { class: "plan-hero" },
          h("div", { class: "plan-kcal" }, fmtEnergy(t.calories, units, false)),
          h("div", { class: "muted" }, `${units.energy} per day · ${GOALS[p.goal].label.toLowerCase()}`),
        ),
        h(
          "div",
          { class: "plan-grid" },
          tile("Protein", `${t.protein} g`, "protein"),
          tile("Carbs", `${t.carbs} g`, "carbs"),
          tile("Fat", `${t.fat} g`, "fat"),
          tile("Fiber", `${t.fiber} g`),
          tile("Water", fmtWater(t.waterMl, units)),
          p.age >= 18 ? tile("BMI", B.toFixed(1)) : tile("Maintenance", fmtEnergy(plan.tdee, units)),
        ),
        eta ? h("p", { class: "plan-eta" }, `📅 At this pace you could reach ${fmtWeight(p.goalWeightKg!, units)} around ${eta.toLocaleDateString(undefined, { month: "long", year: "numeric" })}.`) : null,
        ...plan.notes.map((n) => h("p", { class: "plan-note" }, "⚠️ ", n)),
        h(
          "details",
          { class: "why" },
          h("summary", {}, "How these numbers were worked out"),
          ...plan.why.map((w) => h("div", { class: "why-item" }, h("strong", {}, w.title), h("p", {}, w.text))),
          h("p", { class: "muted small" }, "These are estimates for healthy adults and teens, not medical advice. If you're pregnant, breastfeeding, have a health condition or a history of disordered eating, check with a doctor first."),
        ),
        h("p", { class: "muted small" }, "You can change any target later in Settings."),
      ];
    },
  });

  steps.push({
    nextLabel: opts.firstRun ? "Start tracking" : "Save",
    render: () => {
      const input = h("input", { type: "password", value: apiKey, placeholder: "AIza...", autocomplete: "off" });
      input.addEventListener("input", () => (apiKey = input.value.trim()));
      return [
        h("h2", {}, "Turn on the free AI"),
        h("p", { class: "muted" }, "The AI that reads your food photos is Google Gemini. It's free; you just need your own key."),
        h(
          "ol",
          { class: "ob-steps" },
          h("li", {}, "Open ", h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "aistudio.google.com/apikey"), " and sign in with a Google account."),
          h("li", {}, "Tap ", h("strong", {}, "Create API key"), " and copy it."),
          h("li", {}, "Paste it here."),
        ),
        field("Google AI key", input),
        h("p", { class: "muted small" }, "🔒 Your key is saved only on this phone and only sent to Google. No credit card needed. You can skip this and add it later in Settings."),
      ];
    },
  });

  let i = 0;
  function show() {
    hideToast();
    const st = steps[i];
    body.replaceChildren(...st.render().filter((n): n is Node => n !== null));
    body.scrollTop = 0;
    next.textContent = st.nextLabel ?? "Next";
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
