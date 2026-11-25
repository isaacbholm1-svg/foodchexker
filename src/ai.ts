import { ApiError, GoogleGenAI } from "@google/genai";
import { languageEnglishName, t } from "./i18n";

// Free Google Gemini models, tried in order, used if Google's model list can't be fetched.
// Flash-Lite comes first: it answers in about a second, while the biggest Flash models are
// often overloaded on the free tier. A model that works is remembered for next time.
const MODELS = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-flash-latest"];
const REQUEST_TIMEOUT_MS = 20_000; // one attempt
const TOTAL_BUDGET_MS = 45_000; // all attempts together
const MODEL_KEY = "fc.model.v2";

export interface FoodItem {
  name: string;
  portion: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
}

export interface Analysis {
  meal_name: string;
  items: FoodItem[];
  confidence: "low" | "medium" | "high";
  notes: string;
}

const num = { type: "number" };
const SCHEMA = {
  type: "object",
  properties: {
    meal_name: { type: "string", description: "A short title for the whole meal" },
    items: {
      type: "array",
      description: "One entry per food or drink. Empty if there is no food.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short food name, e.g. 'Scrambled eggs'" },
          portion: { type: "string", description: "Estimated amount, e.g. '2 large eggs' or '1 cup (180 g)'" },
          calories: { ...num, description: "kcal for this portion" },
          protein_g: num,
          carbs_g: num,
          fat_g: num,
          fiber_g: num,
          sugar_g: num,
        },
        required: ["name", "portion", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g"],
      },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    notes: {
      type: "string",
      description: "One or two short sentences on key assumptions (portion size, oil, dressing). Empty if nothing to add.",
    },
  },
  required: ["meal_name", "items", "confidence", "notes"],
};

const SYSTEM = `You are a registered dietitian estimating nutrition from meal photos and descriptions for a calorie-tracking app.

For each distinct food or drink, estimate the portion actually shown or described and give calories and macros for that portion. Use typical USDA-style values. Use visual cues (plate size, utensils, hands, packaging) to judge portion size. Account for hidden calories such as cooking oil, butter, sauces and dressings, and say so in notes when you assumed them. If a packaged product's nutrition label is readable, use it.

If the user gives text along with a photo, treat it as a correction or extra detail (e.g. "only ate half", "made with skim milk").

If there is no food or drink, return an empty items list and explain briefly in notes. Round calories to the nearest 5 and grams to one decimal place.`;

export class AnalysisError extends Error {}

export async function analyzeMeal(opts: {
  apiKey: string;
  image?: { base64: string; mediaType: "image/jpeg" };
  text?: string;
}): Promise<Analysis> {
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
  if (opts.image) parts.push({ inlineData: { mimeType: opts.image.mediaType, data: opts.image.base64 } });
  const text = opts.text?.trim();
  parts.push({
    text: text
      ? opts.image
        ? `Estimate the nutrition for this meal. Extra details from me: ${text}`
        : `Estimate the nutrition for this meal: ${text}`
      : "Estimate the nutrition for this meal.",
  });
  parts.push({ text: `Write meal_name, the food names, portions and notes in ${languageEnglishName()}.` });
  return normalize(await callGemini(opts.apiKey, parts, SYSTEM, SCHEMA));
}

/**
 * Sends a request to the best free Gemini model, with retries and fallbacks:
 * structured JSON first, a plain request if that is rejected or Google is busy, then the next model.
 */
async function callGemini(apiKey: string, parts: Part[], system: string, schema: object): Promise<string> {
  // v1beta has every model (the "-latest" names only exist there) and the structured JSON format.
  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta", httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
  const started = Date.now();
  const remembered = readStorage(MODEL_KEY);
  const listed = await availableModels(ai, apiKey);
  const candidates = listed.length ? listed : MODELS;
  const order = [...new Set([...(remembered && candidates.includes(remembered) ? [remembered] : []), ...candidates])].slice(0, 5);

  let lastError: unknown;
  let lastModel = "";
  const plainModels = (readStorage(PLAIN_KEY) || "").split(",");
  for (const model of order) {
    if (Date.now() - started > TOTAL_BUDGET_MS) break;
    // Try the structured format first, then a plain request (also used as the retry when Google is busy).
    const modes: Mode[] = plainModels.includes(model) ? ["plain", "plain"] : ["schema", "plain"];
    for (let i = 0; i < modes.length; i++) {
      try {
        const raw = await generate(ai, model, parts, modes[i], system, schema);
        writeStorage(MODEL_KEY, model);
        if (modes[i] === "plain" && i === 1 && schemaRejected(lastError)) {
          writeStorage(PLAIN_KEY, [...plainModels.filter(Boolean), model].join(",")); // skip structured mode next time
        }
        return raw;
      } catch (err) {
        if (err instanceof AnalysisError) throw err;
        console.warn("[FoodChecker] AI call failed", model, modes[i], err);
        lastError = err;
        lastModel = model;
        if (i === 0 && (schemaRejected(err) || transient(err)) && !timedOut(err) && Date.now() - started < TOTAL_BUDGET_MS) {
          if (transient(err)) await sleep(900);
          continue; // retry this model with a plain request
        }
        break;
      }
    }
    if (tryNextModel(lastError)) continue;
    break;
  }
  if (remembered) removeStorage(MODEL_KEY);
  const detail = lastError instanceof ApiError ? ` (${lastError.status} · ${lastModel}${googleReason(lastError)})` : "";
  if (lastError instanceof ApiError && modelUnavailable(lastError)) {
    removeStorage(LIST_KEY); // ask Google for a fresh model list next time
    throw new AnalysisError(
      (lastError.status === 429
        ? t("aiNoQuota")
        : t("aiNoModel")) + detail,
    );
  }
  throw new AnalysisError(describeApiError(lastError) + detail);
}

/** Google's own short error text, e.g. "Request contains an invalid argument." */
function googleReason(err: ApiError): string {
  const m = err.message.match(/"message"\s*:\s*"([^"]{1,140})/) ?? err.message.match(/^(?:got status: \d+[^.]*\.\s*)?(.{1,140})/);
  const text = m?.[1]?.trim();
  return text ? ` · ${text}` : "";
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type Mode = "schema" | "plain";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Google is overloaded or had a hiccup: worth retrying or trying another model. */
function transient(err: unknown): boolean {
  return (err instanceof ApiError && (err.status >= 500 || err.status === 408)) || timedOut(err);
}
/** The request took longer than REQUEST_TIMEOUT_MS (the model is probably overloaded). */
function timedOut(err: unknown): boolean {
  return err instanceof Error && !(err instanceof ApiError) && /abort|timed? ?out/i.test(`${err.name} ${err.message}`);
}
/** A 400 that is about the key or country, which no retry or other model can fix. */
function accountProblem(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403 || (err.status === 400 && /api[ _]?key|location|country|region|billing/i.test(err.message)));
}
/** Google rejected this request shape (for example the structured JSON format). A plain request may work. */
function schemaRejected(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && !accountProblem(err);
}
/** Each model has its own quota and load, so most failures are worth trying on the next model. */
function tryNextModel(err: unknown): boolean {
  return timedOut(err) || (err instanceof ApiError && (modelUnavailable(err) || transient(err) || err.status === 429 || schemaRejected(err)));
}

/** One model call, either with Google's structured JSON mode or with plain JSON instructions. */
async function generate(ai: GoogleGenAI, model: string, parts: Part[], mode: Mode, system: string, schema: object): Promise<string> {
  const res =
    mode === "schema"
      ? await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0.2 },
        })
      : await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [...parts, { text: `Reply with only JSON matching this schema, no other text:\n${JSON.stringify(schema)}` }] }],
          config: { systemInstruction: system, temperature: 0.2 },
        });
  if (res.promptFeedback?.blockReason) {
    throw new AnalysisError(t("aiDeclined"));
  }
  const raw = res.text;
  if (!raw) throw new AnalysisError(t("aiNoAnswer"));
  return raw;
}

const LIST_KEY = "fc.models.v3";
const PLAIN_KEY = "fc.plainmodels.v1"; // models that rejected structured JSON mode
const LIST_MAX_AGE = 3 * 24 * 3600 * 1000;

/**
 * Asks Google which models this key can use, and ranks them: newest Flash first (fast and on the
 * free tier), then Flash-Lite. Cached for a few days. Returns [] if the list can't be fetched.
 */
async function availableModels(ai: GoogleGenAI, apiKey: string): Promise<string[]> {
  const keyTag = apiKey.slice(-6);
  try {
    const cached = JSON.parse(readStorage(LIST_KEY) || "null") as { at: number; key: string; models: string[] } | null;
    if (cached && cached.key === keyTag && Date.now() - cached.at < LIST_MAX_AGE && cached.models.length) return cached.models;
  } catch {
    /* ignore bad cache */
  }
  const names: string[] = [];
  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      const name = (m.name ?? "").replace(/^models\//, "");
      const actions = m.supportedActions ?? [];
      if (!name.startsWith("gemini") || (actions.length && !actions.includes("generateContent"))) continue;
      if (/image|tts|audio|live|embed|robotics|transcribe|omni|computer|customtools|native|banana|lyria/i.test(name)) continue;
      if (!/flash/i.test(name)) continue; // Pro models usually have no free tier
      names.push(name);
    }
  } catch {
    return [];
  }
  const version = (n: string) => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
  const score = (n: string) => {
    if (n === "gemini-flash-lite-latest") return 1000;
    if (n === "gemini-flash-latest") return 50;
    let s = version(n) * 10 + (/lite/.test(n) ? 100 : 0); // Flash-Lite first: fast and rarely overloaded
    if (/preview|exp/.test(n)) s -= 5;
    if (/-\d{3}$|-\d{2}-\d{4}$/.test(n)) s -= 2; // pinned snapshots after the plain name
    return s;
  };
  const ranked = [...new Set(names)].sort((a, b) => score(b) - score(a));
  if (ranked.length) writeStorage(LIST_KEY, JSON.stringify({ at: Date.now(), key: keyTag, models: ranked }));
  return ranked;
}

function readStorage(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeStorage(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function removeStorage(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// 404 = model missing or retired; 429 with "limit: 0" = this model has no free quota for this key;
// 400 "not supported/not found" = this model can't do this kind of request.
function modelUnavailable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 404) return true;
  if (err.status === 400 && /not (found|supported)|is not available|unsupported model/i.test(err.message)) return true;
  return err.status === 429 && /limit:\s*0\b/.test(err.message);
}

function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    const msg = err.message.toLowerCase();
    if (err.status === 400 && (msg.includes("api key") || msg.includes("api_key"))) {
      return t("aiBadKey");
    }
    if (err.status === 401 || err.status === 403) return t("aiBadKey");
    if (err.status === 429) {
      return t("aiRateLimit");
    }
    if (err.status === 400 && msg.includes("location")) {
      return t("aiCountry");
    }
    if (err.status >= 500) return t("aiBusy");
    return t("aiRejected");
  }
  if (timedOut(err)) return t("aiBusy");
  if (err instanceof TypeError) return t("aiOffline");
  return err instanceof Error ? err.message : t("somethingWrong");
}

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(x) && x >= 0 ? x : 0;
};
const s = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

function normalize(raw: string): Analysis {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AnalysisError(t("aiUnreadable"));
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const conf = s(data.confidence);
  return {
    meal_name: s(data.meal_name, t("meal")) || t("meal"),
    confidence: conf === "low" || conf === "high" ? conf : "medium",
    notes: s(data.notes),
    items: items
      .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
      .map((i) => ({
        name: s(i.name, t("food")) || t("food"),
        portion: s(i.portion, t("oneServing")) || t("oneServing"),
        calories: n(i.calories),
        protein_g: n(i.protein_g),
        carbs_g: n(i.carbs_g),
        fat_g: n(i.fat_g),
        fiber_g: n(i.fiber_g),
        sugar_g: n(i.sugar_g),
      })),
  };
}

// ---------------- AI meal ideas ----------------

export interface Idea {
  emoji: string;
  title: string;
  detail: string;
  calories: number;
}

const IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      description: "Exactly 3 ideas",
      items: {
        type: "object",
        properties: {
          emoji: { type: "string", description: "One food emoji" },
          title: { type: "string", description: "Short name of the meal or snack, max 6 words" },
          detail: { type: "string", description: "One short sentence: why it fits right now, or a quick how-to" },
          calories: { type: "number", description: "Approximate kcal" },
        },
        required: ["emoji", "title", "detail", "calories"],
      },
    },
  },
  required: ["ideas"],
};

const IDEAS_SYSTEM = `You are a friendly dietitian inside a calorie-tracking app. Suggest practical, everyday meal or snack ideas that fit what the person still needs today.
Rules: ideas must be ordinary foods that are easy to get; respect the remaining calories (never suggest skipping meals or eating very little); favour protein, fiber, fruit and vegetables where they are missing; keep the tone positive and never shame. If the person is under 18, focus on balanced, growth-friendly food. If the remaining calories are negative, suggest light, filling options like vegetables or soup and a glass of water, not "don't eat".`;

/** Three personal meal or snack ideas for the rest of the day. */
export async function suggestIdeas(opts: {
  apiKey: string;
  hour: number;
  goal: string;
  age?: number;
  kcalLeft: number;
  proteinLeft: number;
  fiberLeft: number;
  nextMeal: string;
  eatenToday: string[];
}): Promise<Idea[]> {
  const text = [
    `Time of day: ${opts.hour}:00. Next meal: ${opts.nextMeal}. Goal: ${opts.goal}.${opts.age ? ` Age: ${opts.age}.` : ""}`,
    `Still needed today: about ${Math.round(opts.kcalLeft)} kcal, ${Math.round(opts.proteinLeft)} g protein, ${Math.round(opts.fiberLeft)} g fiber.`,
    opts.eatenToday.length ? `Already eaten today: ${opts.eatenToday.join(", ")}.` : "Nothing eaten yet today.",
    `Give 3 ideas. Write everything in ${languageEnglishName()}.`,
  ].join("\n");
  const raw = await callGemini(opts.apiKey, [{ text }], IDEAS_SYSTEM, IDEAS_SCHEMA);
  let data: { ideas?: unknown };
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AnalysisError(t("aiUnreadable"));
  }
  const list = Array.isArray(data.ideas) ? data.ideas : [];
  return list
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .slice(0, 3)
    .map((i) => ({
      emoji: typeof i.emoji === "string" && i.emoji.length <= 8 ? i.emoji : "🍽️",
      title: typeof i.title === "string" ? i.title.slice(0, 60) : "",
      detail: typeof i.detail === "string" ? i.detail.slice(0, 180) : "",
      calories: typeof i.calories === "number" && i.calories > 0 ? Math.round(i.calories) : 0,
    }))
    .filter((i) => i.title);
}

// ---------------- AI day planner ----------------

export interface PlannedMeal {
  meal: "breakfast" | "lunch" | "dinner" | "snack";
  emoji: string;
  title: string;
  detail: string;
  portion: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  ingredients: string[];
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    meals: {
      type: "array",
      description: "The day's meals in order: breakfast, lunch, dinner and 1–2 snacks",
      items: {
        type: "object",
        properties: {
          meal: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
          emoji: { type: "string", description: "One food emoji" },
          title: { type: "string", description: "Name of the dish, max 6 words" },
          detail: { type: "string", description: "One short sentence: how to make it or why it fits" },
          portion: { type: "string", description: "The portion, e.g. '1 bowl (350 g)'" },
          calories: num,
          protein_g: num,
          carbs_g: num,
          fat_g: num,
          ingredients: { type: "array", items: { type: "string" }, description: "Shopping-list style ingredients with amounts" },
        },
        required: ["meal", "emoji", "title", "detail", "portion", "calories", "protein_g", "carbs_g", "fat_g", "ingredients"],
      },
    },
  },
  required: ["meals"],
};

const PLAN_SYSTEM = `You are a friendly dietitian inside a calorie-tracking app. Plan one realistic day of meals that together hit the person's calorie and protein targets as closely as possible (within about 5%).
Rules: use ordinary, affordable foods that are easy to buy in the person's country; simple home cooking; respect their preferences and allergies strictly; give honest calorie and macro estimates; include vegetables, fruit and fiber; never plan fewer than 3 meals. If the person is under 18, plan balanced, growth-friendly food and never a diet.`;

const MEALS_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;

/** A whole day of meals that fits the targets. */
export async function planDay(opts: {
  apiKey: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  goal: string;
  age?: number;
  prefs: string;
}): Promise<PlannedMeal[]> {
  const text = [
    `Targets for the day: ${Math.round(opts.calories)} kcal, ${Math.round(opts.protein)} g protein, ${Math.round(opts.carbs)} g carbs, ${Math.round(opts.fat)} g fat.`,
    `Goal: ${opts.goal}.${opts.age ? ` Age: ${opts.age}.` : ""}`,
    opts.prefs.trim() ? `Preferences and allergies (follow strictly): ${opts.prefs.trim().slice(0, 300)}` : "No special preferences.",
    `Write titles, details, portions and ingredients in ${languageEnglishName()}. Vary the dishes – surprise me (seed ${Math.floor(Math.random() * 1e6)}).`,
  ].join("\n");
  const raw = await callGemini(opts.apiKey, [{ text }], PLAN_SYSTEM, PLAN_SCHEMA);
  let data: { meals?: unknown };
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AnalysisError(t("aiUnreadable"));
  }
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const meals = (Array.isArray(data.meals) ? data.meals : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .slice(0, 6)
    .map((i) => ({
      meal: (MEALS_ORDER as readonly string[]).includes(i.meal as string) ? (i.meal as PlannedMeal["meal"]) : "snack",
      emoji: typeof i.emoji === "string" && i.emoji.length <= 8 ? i.emoji : "🍽️",
      title: typeof i.title === "string" ? i.title.slice(0, 60) : "",
      detail: typeof i.detail === "string" ? i.detail.slice(0, 200) : "",
      portion: typeof i.portion === "string" ? i.portion.slice(0, 60) : "1 portion",
      calories: n(i.calories),
      protein_g: n(i.protein_g),
      carbs_g: n(i.carbs_g),
      fat_g: n(i.fat_g),
      ingredients: Array.isArray(i.ingredients) ? i.ingredients.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 15) : [],
    }))
    .filter((m) => m.title);
  if (!meals.length) throw new AnalysisError(t("aiUnreadable"));
  return meals.sort((a, b) => MEALS_ORDER.indexOf(a.meal) - MEALS_ORDER.indexOf(b.meal));
}

// ---------------- weekly report ----------------

export interface WeeklyReport {
  headline: string;
  wins: string[];
  focus: string[];
  tip: string;
}

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One upbeat sentence summing up the week, max 14 words" },
    wins: { type: "array", items: { type: "string" }, description: "2–3 specific things that went well, each one short sentence" },
    focus: { type: "array", items: { type: "string" }, description: "1–2 concrete, kind suggestions for next week, each one short sentence" },
    tip: { type: "string", description: "One practical food tip that fits the person, one sentence" },
  },
  required: ["headline", "wins", "focus", "tip"],
};

const REPORT_SYSTEM = `You are a warm, encouraging dietitian coach inside a calorie-tracking app. Write a short weekly report from the numbers you get.
Rules: be specific and use the numbers; celebrate effort and consistency; never shame or use guilt; never suggest eating less than the target or skipping meals; if the person ate far below target, gently encourage eating enough; if few days were logged, praise what was logged and suggest an easy way to log more. If the person is under 18, focus on balanced eating, energy and growth, never on weight loss.`;

export async function weeklyReport(apiKey: string, summary: string): Promise<WeeklyReport> {
  const raw = await callGemini(apiKey, [{ text: `${summary}\nWrite everything in ${languageEnglishName()}.` }], REPORT_SYSTEM, REPORT_SCHEMA);
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AnalysisError(t("aiUnreadable"));
  }
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.slice(0, 220)).slice(0, n) : []);
  const r = {
    headline: typeof d.headline === "string" ? d.headline.slice(0, 160) : "",
    wins: strs(d.wins, 3),
    focus: strs(d.focus, 2),
    tip: typeof d.tip === "string" ? d.tip.slice(0, 220) : "",
  };
  if (!r.headline && !r.wins.length) throw new AnalysisError(t("aiUnreadable"));
  return r;
}

// ---------------- shopping list store sections ----------------

/** Puts shopping list items into grocery store sections (any language). */
export async function classifyAisles(apiKey: string, items: string[], sections: string[]): Promise<Record<string, string>> {
  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { type: "object", properties: { text: { type: "string" }, section: { type: "string", enum: sections } }, required: ["text", "section"] },
      },
    },
    required: ["items"],
  };
  const system = "You sort shopping list items into the section of a Finnish grocery store (K-Market, K-Supermarket, K-Citymarket) where they are found. Eggs and plant milks go in dairy. Return every item with its exact original text.";
  const raw = await callGemini(apiKey, [{ text: `Sections: ${sections.join(", ")}\nItems:\n${items.map((i) => `- ${i}`).join("\n")}` }], system, schema);
  const out: Record<string, string> = {};
  try {
    const d = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    for (const it of Array.isArray(d.items) ? d.items : []) if (typeof it?.text === "string" && sections.includes(it.section)) out[it.text] = it.section;
  } catch {
    /* ignore: keyword guesses are used instead */
  }
  return out;
}

// ---------------- food chat ----------------

export interface ChatTurn {
  role: "user" | "model";
  text: string;
  image?: string; // base64 JPEG, only sent for the newest message
}

export interface ChatReply {
  text: string;
  sources: { title: string; url: string }[];
  log?: string; // a food the person ate, ready to log
}

const CHAT_SYSTEM = `You are FoodChecker's food assistant inside a calorie-tracking app.
You ONLY help with: food, nutrition, calories and macros, ingredients, recipes, cooking, meal planning, grocery shopping, healthy eating habits, hydration, and how food relates to exercise.
If the user asks about anything else (for example news, homework, coding, sports results, politics, celebrities, other apps), politely say in one or two sentences that you can only help with food, nutrition and recipes, and suggest a food-related question instead. Do not answer the off-topic question, even partly.
Safety: never recommend extreme diets, very low calorie intakes, skipping meals, purging, or pills. Be kind and never shame. If someone seems to struggle with eating, gently suggest talking to a doctor or someone they trust. For medical conditions, allergies or pregnancy, give general information and suggest asking a doctor or dietitian. For children and teens, focus on balanced, growth-friendly eating.
Style: friendly and concise. Use short paragraphs or bullet lists. For recipes give: a title, servings, an ingredients list with amounts, numbered steps, and approximate calories and protein per serving. Use metric units unless the user prefers otherwise.
Use Google Search when you need facts you are unsure about (for example nutrition of a specific product or restaurant dish).
Photos: the user may send a photo. If it shows food, say what you see, estimate the portion and the calories, protein, carbs and fat. If it shows no food, say so kindly.
Logging: when the user tells you what they ate or are about to eat, or sends a photo of their meal, end your reply with one extra final line in exactly this format: [[LOG: short description of the food with portion sizes]] (written in the user's language). Add this line only for food the user actually ate or will eat, never for recipes, ideas or general questions. The app turns that line into a "Log it" button, so do not mention it.`;

/** One chat answer. Uses Google Search grounding when the model supports it, otherwise answers without it. */
export async function chatAnswer(opts: { apiKey: string; history: ChatTurn[]; context: string }): Promise<ChatReply> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey, apiVersion: "v1beta", httpOptions: { timeout: 30_000 } });
  const started = Date.now();
  const remembered = readStorage(MODEL_KEY);
  const listed = await availableModels(ai, opts.apiKey);
  const candidates = listed.length ? listed : MODELS;
  const order = [...new Set([...(remembered && candidates.includes(remembered) ? [remembered] : []), ...candidates])].slice(0, 4);
  const system = `${CHAT_SYSTEM}\nAlways reply in ${languageEnglishName()}.\nAbout the user: ${opts.context}`;
  const recent = opts.history.slice(-16);
  const contents = recent.map((m, i) => ({
    role: m.role,
    parts: [
      ...(m.image && i === recent.length - 1 ? [{ inlineData: { mimeType: "image/jpeg", data: m.image } }] : []),
      { text: m.text || "(photo)" },
    ],
  }));

  let lastError: unknown;
  let lastModel = "";
  for (const model of order) {
    if (Date.now() - started > 60_000) break;
    for (const withSearch of [true, false]) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents,
          config: { systemInstruction: system, temperature: 0.6, ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}) },
        });
        if (res.promptFeedback?.blockReason) throw new AnalysisError(t("aiDeclined"));
        let text = res.text?.trim();
        if (!text) throw new AnalysisError(t("aiNoAnswer"));
        let log: string | undefined;
        const marker = text.match(/\[\[\s*LOG\s*:\s*([\s\S]*?)\]\]/i);
        if (marker) {
          log = marker[1].trim().slice(0, 200) || undefined;
          text = text.replace(marker[0], "").trim();
        }
        const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const sources = chunks
          .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
          .filter((s) => s.url.startsWith("https://"))
          .filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i)
          .slice(0, 4);
        writeStorage(MODEL_KEY, model);
        return { text, sources, log };
      } catch (err) {
        if (err instanceof AnalysisError) throw err;
        console.warn("[FoodChecker] chat failed", model, withSearch, err);
        lastError = err;
        lastModel = model;
        // Search isn't available on every model or quota: try the same model without it.
        if (withSearch && err instanceof ApiError && !accountProblem(err) && err.status !== 404) continue;
        break;
      }
    }
    if (tryNextModel(lastError)) {
      if (transient(lastError)) await sleep(600);
      continue;
    }
    break;
  }
  const detail = lastError instanceof ApiError ? ` (${lastError.status} · ${lastModel}${googleReason(lastError)})` : "";
  throw new AnalysisError(describeApiError(lastError) + detail);
}
