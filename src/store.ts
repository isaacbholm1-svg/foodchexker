import type { FoodItem } from "./ai";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface Entry {
  id: string;
  date: string; // YYYY-MM-DD, local time
  time: number; // epoch ms
  meal: MealType;
  name: string;
  thumb?: string;
  items: FoodItem[];
}

export interface Settings {
  apiKey: string;
  calorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

const ENTRIES_KEY = "fc.entries.v1";
const SETTINGS_KEY = "fc.settings.v1";

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  calorieGoal: 2000,
  proteinGoal: 120,
  carbsGoal: 225,
  fatGoal: 65,
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

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

let entries: Entry[] = read<Entry[]>(ENTRIES_KEY, []);

function persist(): void {
  if (write(ENTRIES_KEY, entries)) return;
  // Storage full: drop photo thumbnails from the oldest entries until it fits.
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  for (const e of sorted) {
    if (!e.thumb) continue;
    delete e.thumb;
    if (write(ENTRIES_KEY, entries)) return;
  }
}

export function entriesFor(date: string): Entry[] {
  return entries.filter((e) => e.date === date).sort((a, b) => a.time - b.time);
}

export function addEntry(e: Omit<Entry, "id">): void {
  entries.push({ ...e, id: crypto.randomUUID() });
  persist();
}

export function deleteEntry(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  persist();
}

export function exportCsv(): string {
  const rows = [["date", "meal", "entry", "food", "portion", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g"]];
  for (const e of [...entries].sort((a, b) => a.time - b.time)) {
    for (const i of e.items) {
      rows.push([e.date, e.meal, e.name, i.name, i.portion, ...[i.calories, i.protein_g, i.carbs_g, i.fat_g, i.fiber_g, i.sugar_g].map(String)]);
    }
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function guessMeal(d = new Date()): MealType {
  const h = d.getHours();
  if (h >= 4 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snack";
}
