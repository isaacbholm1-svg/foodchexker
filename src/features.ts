// On/off switches for every feature, so people can keep only what they want.
import type { StringKey } from "./i18n";
import type { Settings } from "./store";

export type FeatureId =
  | "chat"
  | "scanner"
  | "quickadd"
  | "suggestions"
  | "water"
  | "motivation"
  | "tips"
  | "score"
  | "streak"
  | "badges"
  | "weight"
  | "recipes"
  | "shopping"
  | "planner"
  | "exercise"
  | "myfoods"
  | "checkin"
  | "fasting"
  | "shareday"
  | "report";

export interface FeatureInfo {
  id: FeatureId;
  emoji: string;
  label: StringKey;
  hint?: StringKey;
  group: "today" | "progress" | "tools";
}

export const FEATURES: FeatureInfo[] = [
  { id: "chat", emoji: "💬", label: "f_chat", hint: "f_chatHint", group: "tools" },
  { id: "checkin", emoji: "😊", label: "checkin", hint: "checkinDesc", group: "today" },
  { id: "shareday", emoji: "📤", label: "shareDay", hint: "shareDayDesc", group: "today" },
  { id: "fasting", emoji: "⏱️", label: "fasting", hint: "fastingFeatureHint", group: "tools" },
  { id: "exercise", emoji: "🏃", label: "exercise", hint: "exerciseTileDesc", group: "tools" },
  { id: "myfoods", emoji: "🥫", label: "myFoods", hint: "myFoodsDesc", group: "tools" },
  { id: "planner", emoji: "🗓️", label: "planner", hint: "plannerDesc", group: "tools" },
  { id: "recipes", emoji: "📖", label: "recipes", hint: "recipesDesc", group: "tools" },
  { id: "shopping", emoji: "🛒", label: "shopping", hint: "shoppingDesc", group: "tools" },
  { id: "motivation", emoji: "💪", label: "motivationMsgs", hint: "motivationHint", group: "today" },
  { id: "scanner", emoji: "▥", label: "f_scanner", group: "today" },
  { id: "quickadd", emoji: "✏️", label: "f_quickadd", hint: "f_quickaddHint", group: "today" },
  { id: "suggestions", emoji: "✨", label: "f_suggestions", hint: "f_suggestionsHint", group: "today" },
  { id: "water", emoji: "💧", label: "waterTracker", group: "today" },
  { id: "tips", emoji: "💡", label: "tipTitle", group: "today" },
  { id: "score", emoji: "🎯", label: "dayScore", group: "today" },
  { id: "streak", emoji: "🔥", label: "streak", group: "today" },
  { id: "badges", emoji: "🏆", label: "f_badges", hint: "f_badgesHint", group: "progress" },
  { id: "weight", emoji: "⚖️", label: "f_weight", group: "progress" },
  { id: "report", emoji: "📊", label: "report", hint: "reportDesc", group: "progress" },
];

let source: () => Settings;
export function setFeatureSource(get: () => Settings) {
  source = get;
}

export function featureOn(id: FeatureId, s: Settings = source()): boolean {
  if (id === "water") return s.showWater;
  if (id === "motivation") return s.showMotivation;
  return s.features?.[id] !== false;
}

export function setFeature(s: Settings, id: FeatureId, v: boolean) {
  if (id === "water") s.showWater = v;
  else if (id === "motivation") s.showMotivation = v;
  else s.features = { ...s.features, [id]: v };
}
