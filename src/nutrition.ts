// Evidence-based target calculations. All inputs are metric; the UI converts units.
import { locale, t, type StringKey } from "./i18n";
import type { Activity, Goal, Profile, Targets, Units } from "./store";

export const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 };
export const ACTIVITIES = Object.keys(ACTIVITY_FACTOR) as Activity[];
export const activityLabel = (a: Activity) => t(`act_${a}` as StringKey);
export const activityDesc = (a: Activity) => t(`act_${a}_d` as StringKey);

export const GOAL_EMOJI: Record<Goal, string> = { lose: "📉", maintain: "⚖️", muscle: "💪", gain: "📈", healthy: "🥗" };
export const GOALS = Object.keys(GOAL_EMOJI) as Goal[];
export const goalLabel = (g: Goal) => t(`goal_${g}` as StringKey);
export const goalDesc = (g: Goal) => t(`goal_${g}_d` as StringKey);

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
  return bmr(p) * ACTIVITY_FACTOR[p.activity];
}

export interface GoalCheck {
  allowed: boolean;
  reason?: string;
}

/** Safety rules for which goals the app will plan for. */
export function goalAllowed(p: Pick<Profile, "age" | "heightCm" | "weightKg">, goal: Goal): GoalCheck {
  if (goal === "lose") {
    if (p.age < 18) return { allowed: false, reason: t("teenNoDeficit") };
    if (bmi(p) < 18.5) return { allowed: false, reason: t("underweightNoLoss") };
  }
  return { allowed: true };
}

export function paceOptions(goal: Goal): { kg: number; label: string; recommended: boolean }[] {
  if (goal === "lose") {
    return [
      { kg: 0.25, label: t("pace_relaxed"), recommended: false },
      { kg: 0.5, label: t("pace_steady"), recommended: true },
      { kg: 0.75, label: t("pace_faster"), recommended: false },
    ];
  }
  if (goal === "gain") {
    return [
      { kg: 0.25, label: t("pace_lean"), recommended: true },
      { kg: 0.5, label: t("pace_faster"), recommended: false },
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
    notes.push(t("noteRaised"));
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

  if (p.age < 18) notes.push(t("noteTeen"));

  const n = (x: number) => Math.round(x).toLocaleString(locale());
  const why = [
    { title: t("why1t"), text: t("why1", { bmr: n(B), tdee: n(T) }) },
    { title: t("why2t"), text: adj < 0 ? t("why2minus", { n: n(-adj) }) : adj > 0 ? t("why2plus", { n: n(adj) }) : t("why2zero") },
    { title: t("why3t"), text: t("why3", { g: perKg.toLocaleString(locale()) }) },
    { title: t("why4t"), text: t("why4", { pct: Math.round(fatPct * 100) }) },
    { title: t("why5t"), text: t("why5") },
  ];

  return { targets: { calories, protein, carbs, fat, fiber, waterMl }, bmr: B, tdee: T, adjustment: adj, notes, why };
}

/** Estimated date to reach the goal weight at the planned pace, or null. */
export function goalEta(p: Profile, from = new Date()): Date | null {
  if (!p.goalWeightKg || !p.paceKgPerWeek) return null;
  if (p.goal !== "lose" && p.goal !== "gain") return null;
  const diff = p.goalWeightKg - p.weightKg;
  if ((p.goal === "lose" && diff >= 0) || (p.goal === "gain" && diff <= 0)) return null;
  const weeks = Math.abs(diff) / p.paceKgPerWeek;
  return new Date(from.getTime() + weeks * 7 * 86400000);
}

// ---------- unit formatting (numbers follow the app language) ----------
export const KG_PER_LB = 0.45359237;
export const ML_PER_FLOZ = 29.5735;

const num = (v: number, digits = 0) => v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function fmtWeight(kg: number, u: Units, digits = 1): string {
  return u.weight === "kg" ? `${num(kg, digits)} kg` : `${num(kg / KG_PER_LB, digits)} lb`;
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
  const v = num(Math.round(energyValue(kcal, u)));
  return withUnit ? `${v} ${u.energy}` : v;
}
export function fmtWater(ml: number, u: Units): string {
  return u.water === "ml" ? (ml >= 1000 ? `${num(ml / 1000, 1)} L` : `${Math.round(ml)} ml`) : `${Math.round(ml / ML_PER_FLOZ)} fl oz`;
}
export function fmtNum(v: number, digits = 0): string {
  return num(v, digits);
}
