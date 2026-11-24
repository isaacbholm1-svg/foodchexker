// Barcode scanning (camera) + product lookup in Open Food Facts, a free, open food database.
import type { Analysis, FoodItem } from "./ai";
import { getLanguage, t } from "./i18n";

export interface ScanControls {
  stop: () => void;
}

/** Starts the back camera in `video` and calls onCode once with the first barcode found. */
export async function startScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<ScanControls> {
  // Loaded on demand so the scanner code doesn't slow down app start-up.
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
  let done = false;
  const controls = await reader.decodeFromConstraints(
    { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    video,
    (result, _err, c) => {
      if (!result || done) return;
      done = true;
      c.stop();
      onCode(result.getText());
    },
  );
  return { stop: () => controls.stop() };
}

export class LookupError extends Error {}

type Nutriments = Record<string, number | string | undefined>;

interface OffProduct {
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Nutriments;
  image_front_small_url?: string;
  image_small_url?: string;
}

const num = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(x) && x >= 0 ? x : null;
};

/** Looks up a barcode. Returns null if the product isn't in the database. */
export async function lookupBarcode(code: string): Promise<{ analysis: Analysis; image?: string } | null> {
  const clean = code.replace(/\D/g, "");
  if (clean.length < 6 || clean.length > 14) throw new LookupError(t("badBarcode"));
  const fields = `product_name,product_name_${getLanguage()},product_name_en,generic_name,brands,serving_size,serving_quantity,nutriments,image_front_small_url,image_small_url`;
  let res: Response;
  try {
    res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${fields}`);
  } catch {
    throw new LookupError(t("offOffline"));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new LookupError(t("offBusy"));
  const data = (await res.json()) as { status?: number; product?: OffProduct & Record<string, unknown> };
  if (data.status !== 1 || !data.product) return null;
  return toAnalysis(data.product);
}

function toAnalysis(p: OffProduct & Record<string, unknown>): { analysis: Analysis; image?: string } | null {
  const n = p.nutriments ?? {};
  let kcal100 = num(n["energy-kcal_100g"]);
  if (kcal100 == null) {
    const kj = num(n["energy-kj_100g"]) ?? num(n["energy_100g"]);
    if (kj != null) kcal100 = kj / 4.184;
  }
  if (kcal100 == null) return null; // no nutrition info, treat as not found

  const per100 = {
    calories: kcal100,
    protein_g: num(n["proteins_100g"]) ?? 0,
    carbs_g: num(n["carbohydrates_100g"]) ?? 0,
    fat_g: num(n["fat_100g"]) ?? 0,
    fiber_g: num(n["fiber_100g"]) ?? 0,
    sugar_g: num(n["sugars_100g"]) ?? 0,
  };

  const local = p[`product_name_${getLanguage()}`];
  const name = ((typeof local === "string" && local) || p.product_name || p.product_name_en || p.generic_name || t("packagedFood")).trim();
  const brand = (p.brands || "").split(",")[0].trim();
  const title = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;

  const servingG = num(p.serving_quantity);
  const grams = servingG && servingG > 0 && servingG < 2000 ? servingG : 100;
  const f = grams / 100;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const item: FoodItem = {
    name: title,
    portion: servingG ? t("servingPortion", { size: p.serving_size?.trim() || `${grams} g` }) : "100 g",
    calories: Math.round(per100.calories * f),
    protein_g: r1(per100.protein_g * f),
    carbs_g: r1(per100.carbs_g * f),
    fat_g: r1(per100.fat_g * f),
    fiber_g: r1(per100.fiber_g * f),
    sugar_g: r1(per100.sugar_g * f),
  };
  const image = [p.image_front_small_url, p.image_small_url].find((u) => typeof u === "string" && u.startsWith("https://"));
  return {
    analysis: {
      meal_name: title,
      items: [item],
      confidence: "high",
      notes: t("offNote", { kcal: Math.round(per100.calories), p: r1(per100.protein_g), c: r1(per100.carbs_g), f: r1(per100.fat_g) }),
    },
    image,
  };
}
