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

type Pool = { emoji: string; text: string }[];

const P = (lines: string): Pool =>
  lines
    .trim()
    .split("\n")
    .map((l) => {
      const [emoji, ...rest] = l.trim().split(" ");
      return { emoji, text: rest.join(" ") };
    });

const POOLS: Record<string, Pool> = {
  morning: P(`
    ☀️ Good morning, {name}! A good breakfast sets up the whole day.
    🌅 Rise and shine, {name}! Let's make today a great one.
    🥣 Morning, {name}! What's for breakfast today?
    ☕ New day, new chances, {name}. You've got this.
    🌞 Hey {name}! Small choices this morning add up by tonight.
  `),
  empty: P(`
    📸 Fresh page today, {name}. Snap your first meal whenever you're ready.
    ✨ Nothing logged yet, {name}. Every streak starts with one meal.
    👋 Hey {name}! Log a meal and watch your day come together.
    🍽️ Ready when you are, {name}. One photo is all it takes.
  `),
  onTrack: P(`
    💪 Keep going, {name}! You're right on track.
    🚀 Nice pace today, {name}. Keep it up!
    👏 Looking good, {name}! Steady wins the race.
    🌱 You're doing great, {name}. Consistency beats perfection.
    ⭐ Solid choices today, {name}!
    🙌 That's the way, {name}! One meal at a time.
    🧭 Right on course, {name}. Future you says thanks.
    🔋 Fuelled and focused, {name}. Keep going!
    😎 Cool, calm and on track, {name}.
    🎵 You're in the groove today, {name}!
  `),
  onTarget: P(`
    🎯 Bullseye, {name}! Right on your target today.
    🏆 Nailed it, {name}! That's a perfectly balanced day.
    ✅ Goal reached, {name}. Proud of you!
    🥇 Gold-medal day, {name}!
    🌟 Spot on, {name}. That's how it's done.
  `),
  overLose: P(`
    🌱 One day doesn't define you, {name}. Tomorrow is a fresh start.
    🤗 It's okay, {name}. Progress is about the week, not one day.
    🌈 No stress, {name}. Enjoy it and get back on track tomorrow.
    💚 Be kind to yourself, {name}. Every day is a new chance.
    🧘 Breathe, {name}. A little over is part of normal life.
  `),
  overOther: P(`
    🍗 Fuel tank full, {name}! Great work hitting your calories.
    💪 That's what growth looks like, {name}!
    🔥 You ate for your goal today, {name}. Keep it coming!
  `),
  underGain: P(`
    🍝 Keep eating, {name}! Your body needs the fuel to grow.
    🥜 Don't forget a snack, {name}. Every bite counts toward your goal.
    🍌 Still room to go, {name}. You've got this!
  `),
  tooLow: P(`
    💚 Make sure you eat enough today, {name}. Your body needs fuel.
    🍎 Still a lot left, {name}. A proper meal will help you feel your best.
    🥪 Don't skip meals, {name}. Steady fuelling beats going hungry.
  `),
  streak: P(`
    🔥 {streak} days in a row, {name}! You're on fire!
    📅 {streak}-day streak, {name}! Habits are forming.
    🏅 {streak} days straight, {name}. That's real commitment!
    ⚡ {streak} days and counting, {name}. Don't break the chain!
  `),
  protein: P(`
    🥩 Protein goal smashed, {name}! Your muscles thank you.
    🥚 Protein target hit, {name}. Strong work!
  `),
  water: P(`
    💧 Hydration hero, {name}! Water goal done.
    🌊 Water goal reached, {name}. Your body loves you for it.
  `),
  weekend: P(`
    🎉 Happy weekend, {name}! Enjoy it and keep a little balance.
    🛋️ Weekend vibes, {name}. Treat yourself, then log it!
  `),
  past: P(`
    📖 Looking back, {name}? Every day you logged is a win.
    🗓️ Reviewing your history, {name}? That's how you learn what works.
  `),
};

function pick(pool: Pool, seed: number): { emoji: string; text: string } {
  return pool[Math.abs(seed) % pool.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function motivation(c: MotivationContext, dateKey: string): { emoji: string; text: string } {
  const pools: string[] = [];
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

  const seed = hash(dateKey) + c.seed * 7919;
  const pool = POOLS[pools[Math.abs(seed + c.seed) % pools.length]];
  const msg = pick(pool, seed);
  return {
    emoji: msg.emoji,
    text: msg.text.replace(/\{name\}/g, c.name || "friend").replace(/\{streak\}/g, String(c.streak)),
  };
}
