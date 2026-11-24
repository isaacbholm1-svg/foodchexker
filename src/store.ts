import type { FoodItem } from "./ai";
import { t, type Lang } from "./i18n";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type Sex = "male" | "female" | "other";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very";
export type Goal = "lose" | "maintain" | "muscle" | "gain" | "healthy";

export interface Entry {
  id: string;
  date: string; // YYYY-MM-DD, local time
  time: number; // epoch ms
  meal: MealType;
  name: string;
  thumb?: string;
  items: FoodItem[];
}

export interface Profile {
  name: string;
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
  paceKgPerWeek: number; // for lose/gain goals
  goalWeightKg?: number;
}

export interface Units {
  weight: "kg" | "lb";
  height: "cm" | "ftin";
  energy: "kcal" | "kJ";
  water: "ml" | "floz";
}

export interface Targets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  waterMl: number;
}

export interface Settings {
  apiKey: string;
  onboarded: boolean;
  profile: Profile | null;
  autoTargets: boolean;
  targets: Targets;
  units: Units;
  theme: "auto" | "light" | "dark";
  accent: "green" | "blue" | "purple" | "pink" | "orange" | "teal";
  showMotivation: boolean;
  showWater: boolean;
  glassMl: number;
  language?: Lang; // unset = follow the phone's language
}

const ENTRIES_KEY = "fc.entries.v1";
const SETTINGS_KEY = "fc.settings.v2";
const OLD_SETTINGS_KEY = "fc.settings.v1";
const WEIGHTS_KEY = "fc.weights.v1";
const WATER_KEY = "fc.water.v1";

export const DEFAULT_TARGETS: Targets = { calories: 2000, protein: 120, carbs: 225, fat: 65, fiber: 28, waterMl: 2000 };

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  onboarded: false,
  profile: null,
  autoTargets: true,
  targets: DEFAULT_TARGETS,
  units: { weight: "kg", height: "cm", energy: "kcal", water: "ml" },
  theme: "auto",
  accent: "green",
  showMotivation: true,
  showWater: true,
  glassMl: 250,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------- settings ----------
export function loadSettings(): Settings {
  const saved = read<Partial<Settings> | null>(SETTINGS_KEY, null);
  if (saved) {
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      targets: { ...DEFAULT_TARGETS, ...saved.targets },
      units: { ...DEFAULT_SETTINGS.units, ...saved.units },
    };
  }
  // Carry over the key and goals from the first version of the app.
  const old = read<Record<string, unknown>>(OLD_SETTINGS_KEY, {});
  const s = { ...DEFAULT_SETTINGS };
  if (typeof old.apiKey === "string") s.apiKey = old.apiKey;
  return s;
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

// ---------- food entries ----------
let entries: Entry[] = read<Entry[]>(ENTRIES_KEY, []);

function persistEntries(): void {
  if (write(ENTRIES_KEY, entries)) return;
  // Storage full: drop photo thumbnails from the oldest entries until it fits.
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  for (const e of sorted) {
    if (!e.thumb) continue;
    delete e.thumb;
    if (write(ENTRIES_KEY, entries)) return;
  }
}

export function allEntries(): Entry[] {
  return entries;
}

export function entriesFor(date: string): Entry[] {
  return entries.filter((e) => e.date === date).sort((a, b) => a.time - b.time);
}

export function addEntry(e: Omit<Entry, "id">): void {
  entries.push({ ...e, id: crypto.randomUUID() });
  persistEntries();
}

export function deleteEntry(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  persistEntries();
}

/** Distinct recent meals (by name), newest first, for one-tap re-logging. */
export function recentMeals(limit = 8): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of [...entries].sort((a, b) => b.time - a.time)) {
    const key = e.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- weight log ----------
export interface WeightEntry {
  date: string;
  kg: number;
}
let weights: WeightEntry[] = read<WeightEntry[]>(WEIGHTS_KEY, []);

export function allWeights(): WeightEntry[] {
  return [...weights].sort((a, b) => a.date.localeCompare(b.date));
}

export function logWeight(date: string, kg: number): void {
  weights = weights.filter((w) => w.date !== date);
  weights.push({ date, kg });
  write(WEIGHTS_KEY, weights);
}

export function deleteWeight(date: string): void {
  weights = weights.filter((w) => w.date !== date);
  write(WEIGHTS_KEY, weights);
}

// ---------- water ----------
let water: Record<string, number> = read<Record<string, number>>(WATER_KEY, {});

export function waterFor(date: string): number {
  return water[date] ?? 0;
}

export function setWater(date: string, ml: number): void {
  water[date] = Math.max(0, Math.round(ml));
  write(WATER_KEY, water);
}

// ---------- export / backup ----------
export function exportCsv(): string {
  const rows = [["date", "meal", "entry", "food", "portion", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g"]];
  for (const e of [...entries].sort((a, b) => a.time - b.time)) {
    for (const i of e.items) {
      rows.push([e.date, e.meal, e.name, i.name, i.portion, ...[i.calories, i.protein_g, i.carbs_g, i.fat_g, i.fiber_g, i.sugar_g].map(String)]);
    }
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Full backup. The API key is left out on purpose so a shared backup file never leaks it. */
export function exportBackup(settings: Settings): string {
  const { apiKey: _omit, ...rest } = settings;
  return JSON.stringify({ app: "foodchecker", version: 2, exportedAt: new Date().toISOString(), settings: rest, entries, weights, water });
}

export function importBackup(json: string, keepApiKey: string): void {
  const data = JSON.parse(json);
  // "foodchexker" = backups made before the app was renamed.
  if (!data || (data.app !== "foodchecker" && data.app !== "foodchexker") || !Array.isArray(data.entries)) {
    throw new Error(t("notBackup"));
  }
  entries = data.entries;
  weights = Array.isArray(data.weights) ? data.weights : [];
  water = data.water && typeof data.water === "object" ? data.water : {};
  persistEntries();
  write(WEIGHTS_KEY, weights);
  write(WATER_KEY, water);
  if (data.settings) write(SETTINGS_KEY, { ...data.settings, apiKey: keepApiKey });
}

export function resetEverything(): void {
  for (const k of [ENTRIES_KEY, SETTINGS_KEY, OLD_SETTINGS_KEY, WEIGHTS_KEY, WATER_KEY, "fc.model.v1", "fc.models.v2", "fc.plainmodels.v1"]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

// ---------- dates ----------
export function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export function guessMeal(d = new Date()): MealType {
  const h = d.getHours();
  if (h >= 4 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snack";
}
