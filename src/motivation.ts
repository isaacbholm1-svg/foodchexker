import { friendWord, pool, type PoolKey } from "./i18n";
import type { Goal } from "./store";

export interface MotivationContext {
  name: string;
  goal: Goal;
  hour: number;
  eaten: number;
  target: number;
  protein: number;
  proteinTarget: number;
  waterMl: number;
  waterTarget: number;
  streak: number;
  entriesToday: number;
  isToday: boolean;
  weekday: number; // 0 = Sunday
  seed: number; // changes when the user taps to shuffle
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Picks a message that fits the day. Lines in the language files start with an emoji, then a space. */
export function motivation(c: MotivationContext, dateKey: string): { emoji: string; text: string } {
  const pools: PoolKey[] = [];
  const frac = c.target ? c.eaten / c.target : 0;
  const growthGoal = c.goal === "gain" || c.goal === "muscle";

  if (!c.isToday) pools.push("past");
  else {
    if (c.streak >= 3) pools.push("streak");
    if (c.entriesToday === 0) pools.push(c.hour < 11 ? "morning" : "empty");
    else if (frac > 1.08) pools.push(growthGoal ? "overOther" : "overLose");
    else if (frac >= 0.92) pools.push("onTarget");
    else if (c.hour >= 19 && frac < 0.6) pools.push(growthGoal ? "underGain" : "tooLow");
    else pools.push(growthGoal && c.hour >= 15 ? "underGain" : "onTrack");
    if (c.proteinTarget && c.protein >= c.proteinTarget) pools.push("protein");
    if (c.waterTarget && c.waterMl >= c.waterTarget) pools.push("water");
    if (c.weekday === 0 || c.weekday === 6) pools.push("weekend");
  }

  const seed = Math.abs(hash(dateKey) + c.seed * 7919);
  const lines = pool(pools[(seed + c.seed) % pools.length]);
  const line = lines[seed % lines.length];
  const space = line.indexOf(" ");
  return {
    emoji: line.slice(0, space),
    text: line
      .slice(space + 1)
      .replace(/\{name\}/g, c.name || friendWord())
      .replace(/\{streak\}/g, String(c.streak)),
  };
}
