import { ApiError, GoogleGenAI } from "@google/genai";

// Free Google Gemini models, tried in order. A model can drop off the free tier over time;
// when that happens we move on to the next one and remember which one worked.
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3-flash-preview", "gemini-2.5-flash"];
const MODEL_KEY = "fc.model.v1";

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
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

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

  const remembered = readStorage(MODEL_KEY);
  const listed = await availableModels(ai, opts.apiKey);
  const candidates = listed.length ? listed : MODELS;
  const order = [...new Set([...(remembered && candidates.includes(remembered) ? [remembered] : []), ...candidates])].slice(0, 6);

  let lastError: unknown;
  for (const model of order) {
    try {
      const raw = await generate(ai, model, parts);
      writeStorage(MODEL_KEY, model);
      return normalize(raw);
    } catch (err) {
      if (err instanceof AnalysisError) throw err;
      lastError = err;
      if (modelUnavailable(err)) continue; // try the next free model
      break;
    }
  }
  if (remembered) removeStorage(MODEL_KEY);
  if (lastError instanceof ApiError && modelUnavailable(lastError)) {
    removeStorage(LIST_KEY); // ask Google for a fresh model list next time
    throw new AnalysisError(
      lastError.status === 429
        ? "Your key has no free AI quota right now. Wait a few minutes and try again, or try again tomorrow."
        : "Google couldn't find a free AI model for your key. Make sure the key was made at aistudio.google.com/apikey, then try again.",
    );
  }
  throw new AnalysisError(describeApiError(lastError));
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** One model call. Uses Google's structured JSON mode; if a model rejects that, retries with plain JSON instructions. */
async function generate(ai: GoogleGenAI, model: string, parts: Part[]): Promise<string> {
  const read = (res: Awaited<ReturnType<typeof ai.models.generateContent>>) => {
    if (res.promptFeedback?.blockReason) {
      throw new AnalysisError("The AI declined to analyze this. Try a different photo or description.");
    }
    const raw = res.text;
    if (!raw) throw new AnalysisError("The AI didn't return an answer. Please try again.");
    return raw;
  };
  const plainModels = (readStorage(PLAIN_KEY) || "").split(",");
  if (!plainModels.includes(model)) {
    try {
      return read(
        await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0.2 },
        }),
      );
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 400 && /schema|json|mime/i.test(err.message))) throw err;
      writeStorage(PLAIN_KEY, [...plainModels.filter(Boolean), model].join(",")); // skip structured mode next time
    }
  }
  return read(
    await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [...parts, { text: `Reply with only JSON matching this schema, no other text:\n${JSON.stringify(SCHEMA)}` }] }],
      config: { systemInstruction: SYSTEM, temperature: 0.2 },
    }),
  );
}

const LIST_KEY = "fc.models.v2";
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
    if (n === "gemini-flash-latest") return 1000;
    if (n === "gemini-flash-lite-latest") return 900;
    let s = version(n) * 10 + (/lite/.test(n) ? 0 : 100);
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
      return "Your API key was rejected. Check it in Settings.";
    }
    if (err.status === 401 || err.status === 403) return "Your API key was rejected. Check it in Settings.";
    if (err.status === 429) {
      return "You've hit the free usage limit. Wait a minute (or until tomorrow if it keeps happening) and try again.";
    }
    if (err.status === 400 && msg.includes("location")) {
      return "Google's free AI isn't available in your country.";
    }
    if (err.status >= 500) return "Google's AI service is busy. Try again in a moment.";
    return `The request was rejected (${err.status}). Try again.`;
  }
  if (err instanceof TypeError) return "Couldn't reach the AI service. Check your internet connection.";
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
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
    throw new AnalysisError("Couldn't read the AI's answer. Please try again.");
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const conf = s(data.confidence);
  return {
    meal_name: s(data.meal_name, "Meal") || "Meal",
    confidence: conf === "low" || conf === "high" ? conf : "medium",
    notes: s(data.notes),
    items: items
      .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
      .map((i) => ({
        name: s(i.name, "Food") || "Food",
        portion: s(i.portion, "1 serving") || "1 serving",
        calories: n(i.calories),
        protein_g: n(i.protein_g),
        carbs_g: n(i.carbs_g),
        fat_g: n(i.fat_g),
        fiber_g: n(i.fiber_g),
        sugar_g: n(i.sugar_g),
      })),
  };
}
