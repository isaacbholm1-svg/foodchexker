import { featureOn } from "./features";
// Achievements (worked out from the saved data) and the daily score.
import { t, type StringKey } from "./i18n";
import { allWorkouts } from "./exercise";
import { recipeCount } from "./recipes";
import { myFoods } from "./myfoods";
import { checkinDays } from "./checkin";
import { completedFasts } from "./fasting";
import { addDays, allEntries, allFavorites, allWeights, localDate, waterFor, type Entry, type Settings } from "./store";

export interface Badge {
  id: string;
  emoji: string;
  adultsOnly?: boolean;
}

export const BADGES: Badge[] = [
  { id: "first_meal", emoji: "🍽️" },
  { id: "meals_10", emoji: "🥄" },
  { id: "meals_50", emoji: "🍱" },
  { id: "meals_100", emoji: "💯" },
  { id: "streak_3", emoji: "🔥" },
  { id: "streak_7", emoji: "📅" },
  { id: "streak_30", emoji: "👑" },
  { id: "photo", emoji: "📸" },
  { id: "barcode", emoji: "🔎" },
  { id: "quick", emoji: "⚡" },
  { id: "favorite", emoji: "⭐" },
  { id: "water_goal", emoji: "💧" },
  { id: "water_7", emoji: "🌊" },
  { id: "protein_goal", emoji: "🥩" },
  { id: "protein_7", emoji: "💪" },
  { id: "target_7", emoji: "🎯" },
  { id: "weight_first", emoji: "⚖️" },
  { id: "weigh_10", emoji: "📉" },
  { id: "early_bird", emoji: "🌅" },
  { id: "variety_20", emoji: "🌈" },
  { id: "workout_1", emoji: "🏃" },
  { id: "workout_10", emoji: "🏅" },
  { id: "recipe_1", emoji: "📖" },
  { id: "plan_1", emoji: "🗓️" },
  { id: "myfood_1", emoji: "🥫" },
  { id: "checkin_7", emoji: "😊" },
  { id: "fast_1", emoji: "⏱️", adultsOnly: true },
];

/** The achievements this person can see (fasting ones only for adults). */
export const visibleBadges = (settings: Settings) => BADGES.filter((b) => !b.adultsOnly || (settings.profile?.age ?? 0) >= 18);

export const badgeName = (b: Badge) => t(`b_${b.id}` as StringKey);
export const badgeDesc = (b: Badge) => t(`b_${b.id}_d` as StringKey);

interface Day {
  kcal: number;
  protein: number;
}

function byDay(entries: Entry[]): Map<string, Day> {
  const m = new Map<string, Day>();
  for (const e of entries) {
    const d = m.get(e.date) ?? { kcal: 0, protein: 0 };
    for (const i of e.items) {
      d.kcal += i.calories;
      d.protein += i.protein_g;
    }
    m.set(e.date, d);
  }
  return m;
}

function longestStreak(dates: string[]): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev = "";
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Ids of every achievement the saved data currently earns. */
export function earnedBadges(settings: Settings): Set<string> {
  const tg = settings.targets;
  const entries = allEntries();
  const days = byDay(entries);
  const meals = entries.length;
  const streak = longestStreak(entries.map((e) => e.date));
  const sources = new Set(entries.map((e) => e.source));
  const waterDays = [...new Set([...days.keys(), localDate()])].filter((d) => waterFor(d) >= tg.waterMl).length;
  const proteinDays = [...days.values()].filter((d) => d.protein >= tg.protein).length;
  const targetDays = [...days.values()].filter((d) => d.kcal >= tg.calories * 0.9 && d.kcal <= tg.calories * 1.1).length;
  const foods = new Set(entries.flatMap((e) => e.items.map((i) => i.name.trim().toLowerCase())));
  const early = entries.some((e) => e.meal === "breakfast" && new Date(e.time).getHours() < 8);
  const weighIns = allWeights().length;

  const out = new Set<string>();
  const add = (id: string, ok: boolean) => ok && out.add(id);
  add("first_meal", meals >= 1);
  add("meals_10", meals >= 10);
  add("meals_50", meals >= 50);
  add("meals_100", meals >= 100);
  add("streak_3", streak >= 3);
  add("streak_7", streak >= 7);
  add("streak_30", streak >= 30);
  add("photo", sources.has("photo"));
  add("barcode", sources.has("barcode"));
  add("quick", sources.has("quick"));
  add("favorite", allFavorites().length > 0);
  add("water_goal", waterDays >= 1);
  add("water_7", waterDays >= 7);
  add("protein_goal", proteinDays >= 1);
  add("protein_7", proteinDays >= 7);
  add("target_7", targetDays >= 7);
  add("weight_first", weighIns >= 1);
  add("weigh_10", weighIns >= 10);
  add("early_bird", early);
  add("variety_20", foods.size >= 20);
  const workouts = allWorkouts().length;
  add("workout_1", workouts >= 1);
  add("workout_10", workouts >= 10);
  add("recipe_1", recipeCount() >= 1);
  add("plan_1", sources.has("plan"));
  add("myfood_1", myFoods().length >= 1);
  add("checkin_7", checkinDays() >= 7);
  add("fast_1", completedFasts() >= 1);
  return out;
}

export interface ScorePart {
  key: StringKey;
  points: number;
  max: number;
}

/**
 * A 0–100 score for how balanced a day was. Calories score highest right at the target and
 * drop both above and below it, so eating too little never scores well.
 */
export function dayScore(entries: Entry[], waterMl: number, settings: Settings): { score: number; parts: ScorePart[] } | null {
  if (!entries.length) return null;
  const tg = settings.targets;
  const sum = (f: (i: Entry["items"][number]) => number) => entries.reduce((a, e) => a + e.items.reduce((b, i) => b + f(i), 0), 0);
  const kcal = sum((i) => i.calories);
  const protein = sum((i) => i.protein_g);
  const fiber = sum((i) => i.fiber_g);
  const sugar = sum((i) => i.sugar_g);
  const off = Math.abs(kcal - tg.calories) / (tg.calories || 1);
  const sugarLimit = (tg.calories * 0.1) / 4; // ~10% of energy from sugar
  const parts: ScorePart[] = [
    { key: "score_cal", points: Math.round(40 * Math.max(0, 1 - Math.max(0, off - 0.05) / 0.35)), max: 40 },
    { key: "score_protein", points: Math.round(25 * Math.min(1, protein / (tg.protein || 1))), max: 25 },
    { key: "score_fiber", points: Math.round(15 * Math.min(1, fiber / (tg.fiber || 1))), max: 15 },
    { key: "score_water", points: featureOn("water", settings) ? Math.round(10 * Math.min(1, waterMl / (tg.waterMl || 1))) : 10, max: 10 },
    { key: "score_sugar", points: sugar <= sugarLimit ? 10 : Math.round(10 * Math.max(0, 1 - (sugar - sugarLimit) / sugarLimit)), max: 10 },
  ];
  return { score: parts.reduce((a, p) => a + p.points, 0), parts };
}
