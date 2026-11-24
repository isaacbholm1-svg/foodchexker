// Evidence-based target calculations. All inputs are metric; the UI converts units.
import type { Activity, Goal, Profile, Targets, Units } from "./store";

export const ACTIVITY: Record<Activity, { label: string; desc: string; factor: number }> = {
  sedentary: { label: "Mostly sitting", desc: "Desk job or school, little exercise", factor: 1.2 },
  light: { label: "Lightly active", desc: "Walks or light exercise 1–3 days a week", factor: 1.375 },
  moderate: { label: "Moderately active", desc: "Exercise or sports 3–5 days a week", factor: 1.55 },
  active: { label: "Very active", desc: "Hard exercise 6–7 days a week", factor: 1.725 },
  very: { label: "Athlete", desc: "Training twice a day or a physical job", factor: 1.9 },
};

export const GOALS: Record<Goal, { label: string; emoji: string; desc: string }> = {
  lose: { label: "Lose weight", emoji: "📉", desc: "A steady, sustainable calorie deficit" },
  maintain: { label: "Keep my weight stable", emoji: "⚖️", desc: "Eat about what your body uses" },
  muscle: { label: "Build muscle", emoji: "💪", desc: "Small surplus with plenty of protein" },
  gain: { label: "Gain weight", emoji: "📈", desc: "A steady calorie surplus" },
  healthy: { label: "Just eat healthier", emoji: "🥗", desc: "Maintenance calories, focus on quality" },
};

const KCAL_PER_KG = 7700; // approx. energy in 1 kg of body weight change

export function bmi(p: Pick<Profile, "heightCm" | "weightKg">): number {
  const m = p.heightCm / 100;
  return p.weightKg / (m * m);
}

/** Mifflin-St Jeor resting energy (kcal/day). "other" uses the midpoint of the two sex constants. */
export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  const s = p.sex === "male" ? 5 : p.sex === "female" ? -161 : -78;
  return base + s;
}

export function tdee(p: Profile): number {
  return bmr(p) * ACTIVITY[p.activity].factor;
}

export interface GoalCheck {
  allowed: boolean;
  reason?: string;
}

/** Safety rules for which goals the app will plan for. */
export function goalAllowed(p: Pick<Profile, "age" | "heightCm" | "weightKg">, goal: Goal): GoalCheck {
  if (goal === "lose") {
    if (p.age < 18) {
      return { allowed: false, reason: "Under 18, your body is still growing, so the app won't plan a calorie deficit. Talk to a doctor if you're worried about your weight." };
    }
    if (bmi(p) < 18.5) {
      return { allowed: false, reason: "Your weight is already in the underweight range for your height, so the app won't plan weight loss." };
    }
  }
  return { allowed: true };
}

export function paceOptions(goal: Goal): { kg: number; label: string }[] {
  if (goal === "lose") {
    return [
      { kg: 0.25, label: "Relaxed" },
      { kg: 0.5, label: "Steady (recommended)" },
      { kg: 0.75, label: "Faster" },
    ];
  }
  if (goal === "gain") {
    return [
      { kg: 0.25, label: "Lean (recommended)" },
      { kg: 0.5, label: "Faster" },
    ];
  }
  return [];
}

export interface Plan {
  targets: Targets;
  bmr: number;
  tdee: number;
  adjustment: number; // kcal/day vs maintenance
  notes: string[]; // safety notes shown to the user
  why: { title: string; text: string }[];
}

export function makePlan(p: Profile): Plan {
  const B = bmr(p);
  const T = tdee(p);
  const notes: string[] = [];
  let goal = p.goal;
  const check = goalAllowed(p, goal);
  if (!check.allowed) {
    notes.push(check.reason!);
    goal = "maintain";
  }

  let adj = 0;
  if (goal === "lose") {
    // Cap the pace at 1% of body weight per week, and the deficit at 25% of maintenance.
    const pace = Math.min(p.paceKgPerWeek || 0.5, p.weightKg * 0.01);
    adj = -Math.min((pace * KCAL_PER_KG) / 7, T * 0.25);
  } else if (goal === "gain") {
    adj = ((p.paceKgPerWeek || 0.25) * KCAL_PER_KG) / 7;
    if (p.age < 18) adj = Math.min(adj, 300);
  } else if (goal === "muscle") {
    adj = p.age < 18 ? 200 : 300;
  }

  let calories = T + adj;
  const floor = p.sex === "male" ? 1500 : p.sex === "female" ? 1200 : 1350;
  if (goal === "lose" && calories < Math.max(floor, B)) {
    calories = Math.max(floor, B);
    notes.push("Your calorie target was raised to a safe minimum, so weight loss may be slower than the pace you picked.");
  }
  calories = Math.round(calories / 10) * 10;

  // Protein: grams per kg of body weight, based on a reference weight for higher BMIs.
  const refKg = Math.min(p.weightKg, 27 * (p.heightCm / 100) ** 2);
  const perKg = p.age < 18 ? 1.2 : { lose: 1.8, maintain: 1.4, muscle: 2.0, gain: 1.6, healthy: 1.2 }[goal];
  const protein = Math.round(refKg * perKg);

  const fatPct = goal === "muscle" ? 0.25 : 0.3;
  const fat = Math.round(Math.max((calories * fatPct) / 9, p.weightKg * 0.6));
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const fiber = Math.round((calories / 1000) * 14);
  const waterMl = Math.round(Math.min(4000, Math.max(1500, p.weightKg * 35)) / 50) * 50;

  if (p.age < 18) {
    notes.push("Teens need enough energy to grow. Treat these numbers as a rough guide, not a limit.");
  }

  const why = [
    {
      title: "Calories your body uses",
      text: `Your resting burn is about ${Math.round(B)} kcal (Mifflin-St Jeor equation, the formula dietitians use most). Multiplied by your activity level that's about ${Math.round(T)} kcal a day to keep your weight stable.`,
    },
    {
      title: "Your goal",
      text:
        adj < 0
          ? `About ${Math.round(-adj)} kcal less per day. Roughly 7,700 kcal equals 1 kg of body weight, and health guidelines (CDC) recommend losing about 0.5–1 kg (1–2 lb) a week at most.`
          : adj > 0
            ? `About ${Math.round(adj)} kcal more per day. A small surplus helps add muscle while limiting fat gain.`
            : "Calories match what you burn, so your weight should stay about the same.",
    },
    {
      title: "Protein",
      text: `${perKg} g per kg of body weight. Research (International Society of Sports Nutrition) suggests 1.4–2.0 g/kg for active people; higher amounts help keep muscle while losing weight.`,
    },
    {
      title: "Fat, carbs and fiber",
      text: `Fat is ${Math.round(fatPct * 100)}% of calories (guidelines say 20–35%), carbs fill the rest for energy, and fiber is 14 g per 1,000 kcal (Dietary Guidelines for Americans).`,
    },
    {
      title: "Water",
      text: "About 35 ml per kg of body weight from drinks. Food adds more on top. Drink more when it's hot or you exercise.",
    },
  ];

  return {
    targets: { calories, protein, carbs, fat, fiber, waterMl },
    bmr: B,
    tdee: T,
    adjustment: adj,
    notes,
    why,
  };
}

/** Estimated date to reach the goal weight at the planned pace, or null. */
export function goalEta(p: Profile, from = new Date()): Date | null {
  if (!p.goalWeightKg || !p.paceKgPerWeek) return null;
  const diff = p.goalWeightKg - p.weightKg;
  if ((p.goal === "lose" && diff >= 0) || (p.goal === "gain" && diff <= 0)) return null;
  if (p.goal !== "lose" && p.goal !== "gain") return null;
  const weeks = Math.abs(diff) / p.paceKgPerWeek;
  return new Date(from.getTime() + weeks * 7 * 86400000);
}

// ---------- unit formatting ----------
export const KG_PER_LB = 0.45359237;
export const ML_PER_FLOZ = 29.5735;

export function fmtWeight(kg: number, u: Units, digits = 1): string {
  return u.weight === "kg" ? `${kg.toFixed(digits)} kg` : `${(kg / KG_PER_LB).toFixed(digits)} lb`;
}
export function weightValue(kg: number, u: Units): number {
  return u.weight === "kg" ? kg : kg / KG_PER_LB;
}
export function weightToKg(v: number, u: Units): number {
  return u.weight === "kg" ? v : v * KG_PER_LB;
}
export function fmtHeight(cm: number, u: Units): string {
  if (u.height === "cm") return `${Math.round(cm)} cm`;
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)}′${totalIn % 12}″`;
}
export function energyValue(kcal: number, u: Units): number {
  return u.energy === "kcal" ? kcal : kcal * 4.184;
}
export function fmtEnergy(kcal: number, u: Units, withUnit = true): string {
  const v = Math.round(energyValue(kcal, u));
  return withUnit ? `${v.toLocaleString()} ${u.energy}` : v.toLocaleString();
}
export function fmtWater(ml: number, u: Units): string {
  return u.water === "ml" ? (ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${Math.round(ml)} ml`) : `${Math.round(ml / ML_PER_FLOZ)} fl oz`;
}
