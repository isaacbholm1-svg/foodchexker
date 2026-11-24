import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export const MODEL = "claude-opus-5-5";

const FoodItem = z.object({
  name: z.string().describe("Short name of the food, e.g. 'Scrambled eggs'"),
  portion: z
    .string()
    .describe("Estimated amount eaten, e.g. '2 large eggs' or '1 cup (180 g)'"),
  calories: z.number().describe("Estimated kcal for this portion"),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fiber_g: z.number(),
  sugar_g: z.number(),
});

const Analysis = z.object({
  meal_name: z.string().describe("A short title for the whole meal"),
  items: z.array(FoodItem).describe("Empty if no food is visible or described"),
  confidence: z.enum(["low", "medium", "high"]),
  notes: z
    .string()
    .describe(
      "One or two short sentences: key assumptions (portion size, oil, dressing) or a tip. Empty string if nothing to add.",
    ),
});

export type FoodItem = z.infer<typeof FoodItem>;
export type Analysis = z.infer<typeof Analysis>;

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
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // This is a personal app: each user pastes their own key, which stays on their device.
    dangerouslyAllowBrowser: true,
  });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (opts.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: opts.image.mediaType, data: opts.image.base64 },
    });
  }
  const text = opts.text?.trim();
  content.push({
    type: "text",
    text: text
      ? opts.image
        ? `Estimate the nutrition for this meal. Extra details from me: ${text}`
        : `Estimate the nutrition for this meal: ${text}`
      : "Estimate the nutrition for this meal.",
  });

  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "medium", format: betaZodOutputFormat(Analysis) },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    throw new AnalysisError(describeApiError(err));
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisError("The AI declined to analyze this. Try a different photo or description.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnalysisError("The response was cut off. Try a simpler photo or shorter description.");
  }
  if (!response.parsed_output) {
    throw new AnalysisError("Couldn't read the AI's answer. Please try again.");
  }
  return response.parsed_output;
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Your API key was rejected. Check it in Settings.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your API key doesn't have access to this model.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Too many requests right now. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("credit") || msg.includes("billing")) {
      return "Your Anthropic account is out of credits. Add some at platform.claude.com.";
    }
    return `The request was rejected: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the AI service. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `The AI service had a problem (${err.status ?? "unknown"}). Try again.`;
  }
  return err instanceof Error ? err.message : String(err);
}
