// Sorting the shopping list in the order you walk through a K-store (K-Market, K-Supermarket, K-Citymarket).
// Real shelf positions per store aren't public, so items are grouped into store sections and the
// sections follow a typical walking order, which people can rearrange to match their own store.
import type { StringKey } from "./i18n";
import { persisted } from "./store";

export type Section = "produce" | "bakery" | "meat" | "ready" | "dairy" | "cheese" | "frozen" | "dry" | "canned" | "spices" | "breakfast" | "snacks" | "drinks" | "household" | "other";
export type StoreType = "off" | "kmarket" | "ksupermarket" | "kcitymarket" | "custom";

export const SECTIONS: { id: Section; emoji: string; label: StringKey }[] = [
  { id: "produce", emoji: "🥦", label: "sec_produce" },
  { id: "bakery", emoji: "🍞", label: "sec_bakery" },
  { id: "meat", emoji: "🥩", label: "sec_meat" },
  { id: "ready", emoji: "🥪", label: "sec_ready" },
  { id: "dairy", emoji: "🥛", label: "sec_dairy" },
  { id: "cheese", emoji: "🧀", label: "sec_cheese" },
  { id: "frozen", emoji: "🧊", label: "sec_frozen" },
  { id: "dry", emoji: "🍝", label: "sec_dry" },
  { id: "canned", emoji: "🥫", label: "sec_canned" },
  { id: "spices", emoji: "🧂", label: "sec_spices" },
  { id: "breakfast", emoji: "🥣", label: "sec_breakfast" },
  { id: "snacks", emoji: "🍫", label: "sec_snacks" },
  { id: "drinks", emoji: "🥤", label: "sec_drinks" },
  { id: "household", emoji: "🧻", label: "sec_household" },
  { id: "other", emoji: "🛒", label: "sec_other" },
];
export const SECTION_IDS = SECTIONS.map((s) => s.id);

/** Typical walking order from the entrance to the checkout. */
export const STORE_ORDER: Record<Exclude<StoreType, "off" | "custom">, Section[]> = {
  // Small neighbourhood store: fresh produce and bread first, chilled along the back wall.
  kmarket: ["produce", "bakery", "breakfast", "dry", "canned", "spices", "meat", "ready", "dairy", "cheese", "frozen", "drinks", "snacks", "household", "other"],
  // Supermarket: produce, bakery, then service counters / meat, dairy hall, aisles, frozen near the end.
  ksupermarket: ["produce", "bakery", "meat", "ready", "cheese", "dairy", "breakfast", "dry", "canned", "spices", "snacks", "drinks", "frozen", "household", "other"],
  // Hypermarket: non-food at the entrance, then the food hall.
  kcitymarket: ["household", "produce", "bakery", "meat", "ready", "cheese", "dairy", "breakfast", "dry", "canned", "spices", "snacks", "drinks", "frozen", "other"],
};

export const layout = persisted<{ store: StoreType; custom: Section[] }>("fc.storelayout.v1", { store: "off", custom: [] });
const cache = persisted<Record<string, Section>>("fc.shopsec.v1", {});

export function sectionOrder(): Section[] | null {
  const l = layout.get();
  if (l.store === "off") return null;
  if (l.store === "custom") return [...l.custom.filter((s) => SECTION_IDS.includes(s)), ...SECTION_IDS.filter((s) => !l.custom.includes(s))];
  return STORE_ORDER[l.store];
}

// Common words in Finnish, Swedish and English (and a few others) → section.
const WORDS: [Section, string[]][] = [
  ["produce", ["omena", "banaani", "appelsiini", "sitruuna", "peruna", "porkkana", "sipuli", "valkosipuli", "tomaatti", "kurkku", "salaatti", "paprika", "parsakaali", "kukkakaali", "kaali", "pinaatti", "marja", "mansikka", "mustikka", "vadelma", "rypäle", "avokado", "kesäkurpitsa", "sieni", "herne", "inkivääri", "yrtti", "tilli", "persilja", "äpple", "banan", "apelsin", "citron", "potatis", "morot", "morot", "lök", "vitlök", "tomat", "gurka", "sallad", "broccoli", "blomkål", "kål", "spenat", "bär", "jordgubb", "blåbär", "hallon", "druv", "avokado", "zucchini", "svamp", "ingefära", "apple", "banana", "orange", "lemon", "lime", "potato", "carrot", "onion", "garlic", "tomato", "cucumber", "lettuce", "pepper", "spinach", "berries", "strawberr", "blueberr", "raspberr", "grape", "avocado", "mushroom", "ginger", "herb", "kiwi", "mango", "melon", "päron", "pear", "päärynä", "apfel", "kartoffel", "zwiebel"]],
  ["bakery", ["leipä", "ruisleipä", "sämpylä", "patonki", "pulla", "tortilla", "bröd", "limpa", "fralla", "baguette", "bulle", "bread", "bun", "roll", "bagel", "croissant", "pita", "wrap", "brot", "pan ", "pain"]],
  ["meat", ["liha", "jauheliha", "kana", "broileri", "possu", "sika", "nauta", "kinkku", "makkara", "pekoni", "lohi", "kala", "tonnikalafile", "katkarapu", "kött", "färs", "köttfärs", "kyckling", "fläsk", "skinka", "korv", "bacon", "lax", "fisk", "räkor", "meat", "mince", "minced", "chicken", "beef", "pork", "ham", "sausage", "salmon", "fish", "shrimp", "prawn", "turkey", "kalkkuna", "kalkon", "fleisch", "hähnchen", "wurst"]],
  ["ready", ["valmisruoka", "pizza", "lasagne", "sushi", "hummus", "färdigrätt", "ready meal", "salad bowl", "pastasalaatti", "laatikko"]],
  ["dairy", ["maito", "piimä", "jogurtti", "rahka", "kerma", "smetana", "voi", "margariini", "kananmuna", "muna", "rahka", "skyr", "mjölk", "fil", "yoghurt", "kvarg", "grädde", "smör", "ägg", "milk", "yogurt", "yoghurt", "cream", "butter", "egg", "quark", "kefir", "milch", "joghurt", "sahne", "butter", "eier", "kaurajuoma", "havredryck", "oat drink", "oatly"]],
  ["cheese", ["juusto", "feta", "mozzarella", "parmesan", "halloumi", "raejuusto", "tuorejuusto", "ost", "keso", "färskost", "cheese", "cottage", "cream cheese", "käse", "queso", "fromage", "formaggio"]],
  ["frozen", ["pakaste", "jäätelö", "pakaste", "frozen", "fryst", "glass", "ice cream", "jäädytetty", "tiefkühl"]],
  ["dry", ["pasta", "spagetti", "makaroni", "riisi", "nuudeli", "jauho", "vehnäjauho", "sokeri", "kaurahiutale", "puuro", "linssi", "kikherne", "papu", "kvinoa", "bulgur", "ris", "nudlar", "mjöl", "socker", "havregryn", "linser", "kikärt", "bönor", "quinoa", "rice", "noodle", "flour", "sugar", "oats", "oatmeal", "lentil", "chickpea", "beans", "couscous", "reis", "mehl", "zucker", "nudeln"]],
  ["canned", ["säilyke", "tomaattimurska", "tonnikala", "kookosmaito", "passata", "konserv", "krossade tomater", "tonfisk", "kokosmjölk", "canned", "can of", "tin of", "crushed tomato", "tuna", "coconut milk", "dose"]],
  ["spices", ["suola", "pippuri", "mauste", "öljy", "oliiviöljy", "etikka", "ketsuppi", "sinappi", "majoneesi", "soija", "kastike", "liemikuutio", "hunaja", "salt", "peppar", "krydda", "olja", "olivolja", "vinäger", "ketchup", "senap", "majonnäs", "soja", "sås", "buljong", "honung", "spice", "oil", "olive oil", "vinegar", "mustard", "mayo", "soy sauce", "sauce", "stock", "broth", "honey", "paprikajauhe", "curry", "kaneli", "kanel", "cinnamon", "öl "]],
  ["breakfast", ["mysli", "muro", "granola", "maapähkinävoi", "hillo", "müsli", "flingor", "jordnötssmör", "sylt", "muesli", "cereal", "peanut butter", "jam", "marmalade", "cornflakes"]],
  ["snacks", ["suklaa", "karkki", "sipsi", "keksi", "pähkinä", "mantel", "proteiinipatukka", "patukka", "choklad", "godis", "chips", "kex", "nötter", "mandel", "chocolate", "candy", "sweets", "crisps", "cookie", "biscuit", "nuts", "almond", "protein bar", "bar", "popcorn", "schokolade"]],
  ["drinks", ["mehu", "vesi", "kivennäisvesi", "limsa", "kahvi", "tee", "olut", "siideri", "juice", "vatten", "läsk", "kaffe", "te ", "juice", "water", "soda", "coffee", "tea", "beer", "energy drink", "energiajuoma", "saft", "wasser", "kaffee"]],
  ["household", ["wc-paperi", "talouspaperi", "pesuaine", "tiskiaine", "saippua", "shampoo", "hammastahna", "roskapussi", "toalettpapper", "hushållspapper", "tvättmedel", "diskmedel", "tvål", "tandkräm", "soppåsar", "toilet paper", "paper towel", "detergent", "dish soap", "soap", "toothpaste", "bin bags", "trash bags", "foil", "folio", "folie", "plastic wrap", "batteries", "paristo"]],
];

/** A quick guess from known words; null if unsure. */
export function guessSection(text: string): Section | null {
  const cached = cache.get()[text.toLowerCase()];
  if (cached) return cached;
  const s = ` ${text.toLowerCase().replace(/[\d.,]+\s*(g|kg|dl|l|ml|st|kpl|pcs|pkt|pack)?\b/g, " ")} `;
  // "frozen …" always means the freezer, whatever the food is.
  if (/pakaste|fryst|frozen|tiefkühl|jäädytet|surgel|congelad|congelat|diepvries|frossen|frost /.test(s)) return "frozen";
  let best: { sec: Section; len: number } | null = null;
  for (const [sec, words] of WORDS)
    for (const w of words) if (s.includes(w) && (!best || w.length > best.len)) best = { sec, len: w.length };
  return best?.sec ?? null;
}

export function rememberSections(map: Record<string, Section>) {
  const next = { ...cache.get() };
  for (const [k, v] of Object.entries(map)) if (SECTION_IDS.includes(v)) next[k.toLowerCase()] = v;
  // keep the cache small
  const entries = Object.entries(next);
  cache.set(Object.fromEntries(entries.slice(-400)));
}

export const isKnown = (text: string) => !!cache.get()[text.toLowerCase()];
