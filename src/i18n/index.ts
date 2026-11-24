import en from "./en";
import sv from "./sv";
import fi from "./fi";
import de from "./de";
import es from "./es";
import fr from "./fr";
import it from "./it";
import pt from "./pt";
import nl from "./nl";
import nb from "./nb";
import da from "./da";

export type StringKey = keyof typeof en.s;
export type PoolKey = keyof typeof en.pools;
export interface Dict {
  s: Record<StringKey, string>;
  celebrate: string[];
  celebrateNamed: string[];
  tips: string[];
  pools: Record<PoolKey, string[]>;
  friend: string;
}

export type Lang = "en" | "sv" | "fi" | "de" | "es" | "fr" | "it" | "pt" | "nl" | "nb" | "da";

/** Language list shown in the picker: native name + English name (sent to the AI). */
export const LANGUAGES: { code: Lang; name: string; english: string; flag: string; locale: string }[] = [
  { code: "en", name: "English", english: "English", flag: "🇬🇧", locale: "en" },
  { code: "sv", name: "Svenska", english: "Swedish", flag: "🇸🇪", locale: "sv-SE" },
  { code: "fi", name: "Suomi", english: "Finnish", flag: "🇫🇮", locale: "fi-FI" },
  { code: "de", name: "Deutsch", english: "German", flag: "🇩🇪", locale: "de-DE" },
  { code: "es", name: "Español", english: "Spanish", flag: "🇪🇸", locale: "es-ES" },
  { code: "fr", name: "Français", english: "French", flag: "🇫🇷", locale: "fr-FR" },
  { code: "it", name: "Italiano", english: "Italian", flag: "🇮🇹", locale: "it-IT" },
  { code: "pt", name: "Português", english: "Brazilian Portuguese", flag: "🇧🇷", locale: "pt-BR" },
  { code: "nl", name: "Nederlands", english: "Dutch", flag: "🇳🇱", locale: "nl-NL" },
  { code: "nb", name: "Norsk", english: "Norwegian (Bokmål)", flag: "🇳🇴", locale: "nb-NO" },
  { code: "da", name: "Dansk", english: "Danish", flag: "🇩🇰", locale: "da-DK" },
];

const DICTS: Record<Lang, Dict> = { en, sv, fi, de, es, fr, it, pt, nl, nb, da };

let current: Lang = "en";

/** The phone's language if we support it, else English. */
export function detectLanguage(): Lang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "no" || base === "nn") return "nb";
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

export function tips(): string[] {
  const d = DICTS[current];
  return d.tips?.length ? d.tips : en.tips;
}

export function friendWord(): string {
  return DICTS[current].friend;
}

export { fill };
