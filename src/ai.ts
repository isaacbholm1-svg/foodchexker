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

  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(MODEL_KEY);
  } catch {
    /* storage unavailable */
  }
  const order = remembered && MODELS.includes(remembered) ? [remembered, ...MODELS.filter((m) => m !== remembered)] : MODELS;

  let lastError: unknown;
  for (const model of order) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: "application/json",
          responseJsonSchema: SCHEMA,
          temperature: 0.2,
        },
      });
      try {
        localStorage.setItem(MODEL_KEY, model);
      } catch {
        /* ignore */
      }
      if (res.promptFeedback?.blockReason) {
        throw new AnalysisError("The AI declined to analyze this. Try a different photo or description.");
      }
      const raw = res.text;
      if (!raw) throw new AnalysisError("The AI didn't return an answer. Please try again.");
      return normalize(raw);
    } catch (err) {
      if (err instanceof AnalysisError) throw err;
      lastError = err;
      if (modelUnavailable(err)) continue; // try the next free model
      break;
    }
  }
  throw new AnalysisError(describeApiError(lastError));
}

// 404 = model retired; 429 with "limit: 0" = this model has no free quota for this key.
function modelUnavailable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 404) return true;
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
