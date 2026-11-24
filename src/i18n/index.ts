import en from "./en";
import sv from "./sv";
import fi from "./fi";

export type StringKey = keyof typeof en.s;
export type PoolKey = keyof typeof en.pools;
export interface Dict {
  s: Record<StringKey, string>;
  celebrate: string[];
  celebrateNamed: string[];
  pools: Record<PoolKey, string[]>;
  friend: string;
}

export type Lang = "en" | "sv" | "fi"; // more languages coming later

/** Language list shown in the picker: native name + English name (sent to the AI). */
export const LANGUAGES: { code: Lang; name: string; english: string; flag: string; locale: string }[] = [
  { code: "en", name: "English", english: "English", flag: "🇬🇧", locale: "en" },
  { code: "sv", name: "Svenska", english: "Swedish", flag: "🇸🇪", locale: "sv-SE" },
  { code: "fi", name: "Suomi", english: "Finnish", flag: "🇫🇮", locale: "fi-FI" },
];

const DICTS: Record<Lang, Dict> = { en, sv, fi };

let current: Lang = "en";

/** The phone's language if we support it, else English. */
export function detectLanguage(): Lang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (base in DICTS) return base as Lang;
  }
  return "en";
}

export function setLanguage(lang: Lang) {
  current = lang in DICTS ? lang : "en";
  document.documentElement.lang = current;
}

export function getLanguage(): Lang {
  return current;
}

export function locale(): string {
  return LANGUAGES.find((l) => l.code === current)!.locale;
}

export function languageEnglishName(): string {
  return LANGUAGES.find((l) => l.code === current)!.english;
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Translate a UI string. Falls back to English if a translation is missing. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  return fill(DICTS[current].s[key] ?? en.s[key], vars);
}

export function pool(key: PoolKey): string[] {
  const p = DICTS[current].pools[key];
  return p && p.length ? p : en.pools[key];
}

export function celebrateLines(named: boolean): string[] {
  const d = DICTS[current];
  return named ? [...d.celebrate, ...d.celebrateNamed] : d.celebrate;
}

export function friendWord(): string {
  return DICTS[current].friend;
}

export { fill };
