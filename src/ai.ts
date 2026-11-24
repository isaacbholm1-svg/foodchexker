import { ApiError, GoogleGenAI } from "@google/genai";
import { languageEnglishName, t } from "./i18n";

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
  parts.push({ text: `Write meal_name, the food names, portions and notes in ${languageEnglishName()}.` });

  const remembered = readStorage(MODEL_KEY);
  const listed = await availableModels(ai, opts.apiKey);
  const candidates = listed.length ? listed : MODELS;
  const order = [...new Set([...(remembered && candidates.includes(remembered) ? [remembered] : []), ...candidates])].slice(0, 5);

  let lastError: unknown;
  let lastModel = "";
  const plainModels = (readStorage(PLAIN_KEY) || "").split(",");
  for (const model of order) {
    // Try the structured format first, then a plain request (also used as the retry when Google is busy).
    const modes: Mode[] = plainModels.includes(model) ? ["plain", "plain"] : ["schema", "plain"];
    for (let i = 0; i < modes.length; i++) {
      try {
        const raw = await generate(ai, model, parts, modes[i]);
        writeStorage(MODEL_KEY, model);
        if (modes[i] === "plain" && i === 1 && schemaRejected(lastError)) {
          writeStorage(PLAIN_KEY, [...plainModels.filter(Boolean), model].join(",")); // skip structured mode next time
        }
        return normalize(raw);
      } catch (err) {
        if (err instanceof AnalysisError) throw err;
        console.warn("[FoodChecker] AI call failed", model, modes[i], err);
        lastError = err;
        lastModel = model;
        if (i === 0 && (schemaRejected(err) || transient(err))) {
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
  const detail = lastError instanceof ApiError ? ` (${lastError.status} · ${lastModel})` : "";
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

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type Mode = "schema" | "plain";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Google is overloaded or had a hiccup: worth retrying or trying another model. */
function transient(err: unknown): boolean {
  return err instanceof ApiError && (err.status >= 500 || err.status === 408);
}
function schemaRejected(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /schema|json|mime/i.test(err.message);
}
/** Each model has its own quota and load, so most failures are worth trying on the next model. */
function tryNextModel(err: unknown): boolean {
  return err instanceof ApiError && (modelUnavailable(err) || transient(err) || err.status === 429 || schemaRejected(err));
}

/** One model call, either with Google's structured JSON mode or with plain JSON instructions. */
async function generate(ai: GoogleGenAI, model: string, parts: Part[], mode: Mode): Promise<string> {
  const res =
    mode === "schema"
      ? await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0.2 },
        })
      : await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [...parts, { text: `Reply with only JSON matching this schema, no other text:\n${JSON.stringify(SCHEMA)}` }] }],
          config: { systemInstruction: SYSTEM, temperature: 0.2 },
        });
  if (res.promptFeedback?.blockReason) {
    throw new AnalysisError(t("aiDeclined"));
  }
  const raw = res.text;
  if (!raw) throw new AnalysisError(t("aiNoAnswer"));
  return raw;
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
    return t("aiRejected", { status: err.status });
  }
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
