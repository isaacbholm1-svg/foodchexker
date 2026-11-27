// Personal look-and-feel choices: text size, pure black, start tab, Today card order,
// what the ring shows, effects, and meal names.
import { persisted } from "./store";

export type CardId = "motivation" | "summary" | "add" | "suggestions" | "water" | "exercise" | "meals" | "tip";
export type MealKey = "breakfast" | "lunch" | "dinner" | "snack";

export interface Custom {
  textSize: "s" | "m" | "l" | "xl";
  black: boolean;
  startTab: "today" | "chat" | "stats";
  order: CardId[];
  ring: "left" | "eaten";
  confetti: boolean;
  motion: boolean;
  compact: boolean;
  meals: Partial<Record<MealKey, { name?: string; emoji?: string }>>;
}

export const DEFAULT_ORDER: CardId[] = ["motivation", "summary", "add", "suggestions", "water", "exercise", "meals", "tip"];
export const DEFAULT_CUSTOM: Custom = {
  textSize: "m",
  black: false,
  startTab: "today",
  order: DEFAULT_ORDER,
  ring: "left",
  confetti: true,
  motion: true,
  compact: false,
  meals: {},
};

const store = persisted<Partial<Custom>>("fc.custom.v1", {});

export function custom(): Custom {
  const c = { ...DEFAULT_CUSTOM, ...store.get() };
  // Keep every card exactly once, even after an update adds new cards.
  const order = c.order.filter((id, i) => DEFAULT_ORDER.includes(id) && c.order.indexOf(id) === i);
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.splice(DEFAULT_ORDER.indexOf(id), 0, id);
  return { ...c, order };
}

export function setCustom(patch: Partial<Custom>) {
  store.set({ ...store.get(), ...patch });
  applyCustom();
}

export function resetCustom() {
  store.set({});
  applyCustom();
}

/** Put the look choices on <html> so CSS can use them. */
export function applyCustom() {
  const c = custom();
  const root = document.documentElement.dataset;
  root.text = c.textSize;
  root.black = String(c.black);
  root.motion = String(c.motion);
  root.compact = String(c.compact);
}

export const MEAL_EMOJI_DEFAULT: Record<MealKey, string> = { breakfast: "🍳", lunch: "🥪", dinner: "🍝", snack: "🍎" };
export const mealEmoji = (m: MealKey) => custom().meals[m]?.emoji?.trim() || MEAL_EMOJI_DEFAULT[m];
export const mealName = (m: MealKey) => custom().meals[m]?.name?.trim() || "";
