import "./style.css";
import { analyzeMeal, AnalysisError, type Analysis, type FoodItem } from "./ai";
import { LookupError, lookupBarcode, startScanner, type ScanControls } from "./barcode";
import { prepareImage } from "./image";
import { motivation } from "./motivation";
import { ACTIVITY, GOALS, energyValue, fmtEnergy, fmtHeight, fmtWater, fmtWeight, makePlan, weightToKg, weightValue } from "./nutrition";
import { runOnboarding, type OnboardingResult } from "./onboarding";
import { currentStreak, renderStats, type Range } from "./stats";
import {
  addDays,
  addEntry,
  allWeights,
  deleteEntry,
  deleteWeight,
  entriesFor,
  exportBackup,
  exportCsv,
  guessMeal,
  importBackup,
  loadSettings,
  localDate,
  logWeight,
  parseDate,
  recentMeals,
  resetEverything,
  saveSettings,
  setWater,
  waterFor,
  type Entry,
  type MealType,
  type Settings,
  type Targets,
} from "./store";
import { $, download, h, segmented, toast, toggle } from "./ui";

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABEL: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };
const ACCENTS: Settings["accent"][] = ["green", "blue", "purple", "pink", "orange", "teal"];

let settings = loadSettings();
let viewDate = localDate();
let tab: "today" | "stats" | "settings" = "today";
let statsRange: Range = "week";
let motivationSeed = 0;
let draftText = "";

const round = Math.round;
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
const U = () => settings.units;

function sum(items: FoodItem[]) {
  return items.reduce(
    (t, i) => ({ calories: t.calories + i.calories, protein_g: t.protein_g + i.protein_g, carbs_g: t.carbs_g + i.carbs_g, fat_g: t.fat_g + i.fat_g }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

function save() {
  saveSettings(settings);
}

function recomputeTargets() {
  if (settings.autoTargets && settings.profile) settings.targets = makePlan(settings.profile).targets;
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
}

// ======================= navigation =======================
function setTab(t: typeof tab) {
  tab = t;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    if (b.dataset.tab === t) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  $("view-today").hidden = t !== "today";
  $("view-stats").hidden = t !== "stats";
  $("view-settings").hidden = t !== "settings";
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  if (tab === "today") renderToday();
  else if (tab === "stats") renderStats($("view-stats"), settings, statsRange, (r) => { statsRange = r; render(); }, openWeightDialog);
  else renderSettings();
}

// ======================= today =======================
function dayLabel(date: string): string {
  const today = localDate();
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return parseDate(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function renderToday() {
  const root = $("view-today");
  const u = U();
  const tg = settings.targets;
  const isToday = viewDate === localDate();
  const entries = entriesFor(viewDate);
  const totals = sum(entries.flatMap((e) => e.items));
  const waterMl = waterFor(viewDate);

  // --- header ---
  const header = h(
    "header",
    { class: "topbar" },
    h("button", { class: "icon-btn", "aria-label": "Previous day", onclick: () => { viewDate = addDays(viewDate, -1); render(); } }, "‹"),
    h("button", { class: "day-label", onclick: () => { viewDate = localDate(); render(); } }, dayLabel(viewDate)),
    h("button", { class: "icon-btn", "aria-label": "Next day", disabled: isToday, onclick: () => { if (!isToday) { viewDate = addDays(viewDate, 1); render(); } } }, "›"),
  );

  // --- motivation ---
  let moti: HTMLElement | null = null;
  if (settings.showMotivation && settings.profile) {
    const m = motivation(
      {
        name: settings.profile.name,
        goal: settings.profile.goal,
        hour: new Date().getHours(),
        eaten: totals.calories,
        target: tg.calories,
        protein: totals.protein_g,
        proteinTarget: tg.protein,
        waterMl,
        waterTarget: settings.showWater ? tg.waterMl : 0,
        streak: currentStreak(),
        entriesToday: entries.length,
        isToday,
        weekday: parseDate(viewDate).getDay(),
        seed: motivationSeed,
      },
      viewDate,
    );
    moti = h(
      "button",
      { class: "card motivation", "aria-label": `${m.text} Tap for another message.`, onclick: () => { motivationSeed++; render(); } },
      h("span", { class: "moti-emoji", "aria-hidden": "true" }, m.emoji),
      h("span", { class: "moti-text" }, m.text),
    );
  }

  // --- summary ring + macros ---
  const left = tg.calories - totals.calories;
  const frac = Math.min(totals.calories / (tg.calories || 1), 1);
  const C = 2 * Math.PI * 52;
  const ringSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ringSvg.setAttribute("viewBox", "0 0 120 120");
  ringSvg.setAttribute("class", "ring");
  ringSvg.setAttribute("aria-hidden", "true");
  ringSvg.innerHTML = `<circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-fill${left < 0 ? " over" : ""}" cx="60" cy="60" r="52" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - frac)}"/>`;
  const macro = (label: string, key: string, val: number, goal: number) =>
    h(
      "div",
      { class: "macro", "data-macro": key },
      h("div", { class: "macro-head" }, h("span", {}, label), h("span", { class: "macro-val" }, `${round(val)} / ${goal} g`)),
      h("div", { class: "bar" }, h("div", { class: "bar-fill", style: `width:${Math.min((val / (goal || 1)) * 100, 100)}%` })),
    );
  const summary = h(
    "section",
    { class: "card summary", "aria-label": "Daily summary" },
    h(
      "div",
      { class: "ring-wrap" },
      ringSvg,
      h("div", { class: "ring-text" }, h("div", { class: fmtEnergy(Math.abs(left), u, false).length > 5 ? "ring-num long" : "ring-num" }, fmtEnergy(Math.abs(left), u, false)), h("div", { class: "ring-sub" }, `${u.energy} ${left < 0 ? "over" : "left"}`)),
    ),
    h(
      "div",
      { class: "summary-side" },
      h("div", { class: "eaten" }, `${fmtEnergy(totals.calories, u, false)} / ${fmtEnergy(tg.calories, u)}`),
      macro("Protein", "protein", totals.protein_g, tg.protein),
      macro("Carbs", "carbs", totals.carbs_g, tg.carbs),
      macro("Fat", "fat", totals.fat_g, tg.fat),
    ),
  );

  // --- add food ---
  const textInput = h("input", { id: "text-input", type: "text", placeholder: "e.g. 2 eggs, toast with butter, coffee", autocomplete: "off", enterkeyhint: "go", value: draftText, "aria-label": "Describe what you ate" });
  textInput.addEventListener("input", () => (draftText = textInput.value));
  const form = h("form", { class: "text-form" }, textInput, h("button", { type: "submit", class: "btn primary" }, "Analyze"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return textInput.focus();
    textInput.blur();
    runAnalysis({ text });
  });
  const recents = recentMeals(10);
  const add = h(
    "section",
    { class: "card add", "aria-label": "Add food" },
    h("label", { class: "snap-btn", for: "photo-input" }, h("span", { class: "cam", "aria-hidden": "true" }, "📷"), h("span", {}, "Snap or pick a food photo")),
    h("button", { type: "button", class: "scan-btn", onclick: openScanner }, h("span", { class: "barcode-icon", "aria-hidden": "true" }), h("span", {}, "Scan a barcode")),
    h("div", { class: "or" }, "or describe it"),
    form,
    recents.length
      ? h(
          "div",
          { class: "recents" },
          h("div", { class: "muted small recents-title" }, "Log again (no AI needed)"),
          h("div", { class: "chips" }, ...recents.map((e) => h("button", { class: "chip", onclick: () => reLog(e) }, e.thumb ? h("img", { src: e.thumb, alt: "" }) : null, h("span", {}, e.name)))),
        )
      : null,
  );

  // --- water ---
  let waterCard: HTMLElement | null = null;
  if (settings.showWater) {
    const glasses = Math.round(waterMl / settings.glassMl);
    const goalGlasses = Math.max(1, Math.round(tg.waterMl / settings.glassMl));
    waterCard = h(
      "section",
      { class: "card water" },
      h("div", { class: "card-head" }, h("h3", {}, "💧 Water"), h("span", { class: "muted" }, `${fmtWater(waterMl, u)} / ${fmtWater(tg.waterMl, u)}`)),
      h(
        "div",
        { class: "water-row" },
        h("button", { class: "round-btn", "aria-label": "Remove a glass", onclick: () => { setWater(viewDate, waterMl - settings.glassMl); render(); } }, "−"),
        h("div", { class: "glasses", role: "img", "aria-label": `${glasses} of ${goalGlasses} glasses` }, ...Array.from({ length: Math.min(16, Math.max(goalGlasses, glasses)) }, (_, i) => h("span", { class: i < glasses ? "glass full" : "glass" }))),
        h(
          "button",
          {
            class: "round-btn primary",
            "aria-label": "Add a glass",
            onclick: () => {
              setWater(viewDate, waterMl + settings.glassMl);
              if (waterMl + settings.glassMl >= tg.waterMl && waterMl < tg.waterMl) toast(`💧 Water goal reached${settings.profile ? `, ${settings.profile.name}` : ""}!`);
              render();
            },
          },
          "+",
        ),
      ),
      h("div", { class: "muted small" }, `One glass = ${fmtWater(settings.glassMl, u)}`),
    );
  }

  // --- log ---
  const log = h("section", { class: "log", "aria-label": "Food log" });
  if (!entries.length) {
    log.append(h("div", { class: "empty" }, isToday ? "Nothing logged yet today. Snap your first meal above." : "Nothing logged this day."));
  }
  for (const meal of MEALS) {
    const list = entries.filter((e) => e.meal === meal);
    if (!list.length) continue;
    log.append(
      h(
        "div",
        { class: "card meal-group" },
        h("div", { class: "meal-head" }, h("h3", {}, MEAL_LABEL[meal]), h("span", { class: "muted" }, fmtEnergy(sum(list.flatMap((e) => e.items)).calories, u))),
        ...list.map(renderEntry),
      ),
    );
  }

  root.replaceChildren(
    header,
    ...(moti ? [moti] : []),
    summary,
    add,
    ...(waterCard ? [waterCard] : []),
    log,
    h("p", { class: "footer-note" }, "Estimates from AI. Use them as a guide, not medical advice."),
  );
}

function renderEntry(e: Entry) {
  const tot = sum(e.items);
  const u = U();
  const details = h(
    "div",
    { class: "entry-items" },
    ...e.items.map((i) => h("div", { class: "entry-item" }, h("span", {}, `${i.name} · ${i.portion}`), h("span", { class: "muted" }, fmtEnergy(i.calories, u, false)))),
    h(
      "div",
      { class: "entry-actions" },
      h("button", { class: "btn small", onclick: () => reLog(e) }, "Log again"),
      h("button", { class: "btn danger small", onclick: () => { if (confirm(`Delete "${e.name}"?`)) { deleteEntry(e.id); render(); } } }, "Delete"),
    ),
  );
  const row = h(
    "button",
    { class: "entry", "aria-expanded": "false" },
    e.thumb ? h("img", { class: "thumb", src: e.thumb, alt: "" }) : h("div", { class: "thumb placeholder" }, "🍽"),
    h("div", { class: "entry-main" }, h("div", { class: "entry-name" }, e.name), h("div", { class: "muted small" }, `P ${round(tot.protein_g)} · C ${round(tot.carbs_g)} · F ${round(tot.fat_g)} g`)),
    h("div", { class: "entry-kcal" }, fmtEnergy(tot.calories, u, false)),
  );
  row.addEventListener("click", () => {
    const open = row.getAttribute("aria-expanded") === "true";
    row.setAttribute("aria-expanded", String(!open));
    details.classList.toggle("open", !open);
  });
  return h("div", { class: "entry-wrap" }, row, details);
}

function reLog(e: Entry) {
  showReview({ meal_name: e.name, items: e.items.map((i) => ({ ...i })), confidence: "high", notes: "" }, { thumb: e.thumb, preview: e.thumb, noBadge: true });
}

// ======================= analysis + review =======================
const review = $("review") as HTMLDialogElement;

async function runAnalysis(input: { file?: File; text?: string }) {
  if (!settings.apiKey) {
    toast("Add your free Google AI key in Settings first.", 5000);
    setTab("settings");
    return;
  }
  let image: { base64: string; mediaType: "image/jpeg" } | undefined;
  let thumb: string | undefined;
  let preview: string | undefined;
  try {
    if (input.file) {
      const p = await prepareImage(input.file);
      image = { base64: p.base64, mediaType: "image/jpeg" };
      thumb = p.thumb;
      preview = p.preview;
    }
  } catch {
    toast("Couldn't read that photo. Try a different one.");
    return;
  }
  $("review-body").replaceChildren(
    h("div", { class: "loading" }, preview ? h("img", { class: "review-photo", src: preview, alt: "" }) : null, h("div", { class: "spinner", "aria-hidden": "true" }), h("p", {}, "Looking at your food…")),
  );
  if (!review.open) review.showModal();
  try {
    const result = await analyzeMeal({ apiKey: settings.apiKey, image, text: input.text });
    showReview(result, { thumb, preview });
  } catch (err) {
    review.close();
    toast(err instanceof AnalysisError ? err.message : "Something went wrong. Try again.", 6000);
  }
}

function showReview(result: Analysis, opt: { thumb?: string; preview?: string; noBadge?: boolean }) {
  const u = U();
  const items: FoodItem[] = result.items.map((i) => ({ ...i }));
  let servings = 1;
  let meal: MealType = viewDate === localDate() ? guessMeal() : "snack";
  const nameInput = h("input", { class: "title-input", value: result.meal_name, "aria-label": "Meal name" });
  const itemsBox = h("div", { class: "review-items" });
  const totalsBox = h("div", { class: "review-totals" });
  const servingsLabel = h("span", { class: "serv-val" }, "1×");

  const scaled = (i: FoodItem): FoodItem => ({
    ...i,
    calories: i.calories * servings,
    protein_g: i.protein_g * servings,
    carbs_g: i.carbs_g * servings,
    fat_g: i.fat_g * servings,
    fiber_g: i.fiber_g * servings,
    sugar_g: i.sugar_g * servings,
  });

  const addBtn = h("button", { class: "btn primary" }, "Add to log");

  function update() {
    servingsLabel.textContent = `${servings}×`;
    itemsBox.replaceChildren(
      ...items.map((item, idx) => {
        const kcal = h("input", { class: "kcal-input", type: "number", inputmode: "numeric", value: String(round(energyValue(item.calories, u))), "aria-label": `${u.energy} for ${item.name}` });
        kcal.addEventListener("change", () => {
          const shown = Math.max(0, Number(kcal.value) || 0);
          const v = u.energy === "kJ" ? shown / 4.184 : shown;
          const ratio = item.calories > 0 ? v / item.calories : 0;
          // Editing calories scales the item's macros by the same amount.
          items[idx] = { ...item, calories: v, protein_g: item.protein_g * ratio, carbs_g: item.carbs_g * ratio, fat_g: item.fat_g * ratio, fiber_g: item.fiber_g * ratio, sugar_g: item.sugar_g * ratio };
          update();
        });
        return h(
          "div",
          { class: "review-item" },
          h("div", { class: "ri-main" }, h("div", { class: "ri-name" }, item.name), h("div", { class: "muted small" }, `${item.portion} · P ${fmt1(item.protein_g)} · C ${fmt1(item.carbs_g)} · F ${fmt1(item.fat_g)}`)),
          kcal,
          h("button", { class: "icon-btn remove", "aria-label": `Remove ${item.name}`, onclick: () => { items.splice(idx, 1); update(); } }, "×"),
        );
      }),
    );
    if (!items.length) itemsBox.append(h("p", { class: "muted" }, "No food items. Cancel and try another photo or description."));
    const tot = sum(items.map(scaled));
    totalsBox.replaceChildren(
      h("div", { class: "tot-kcal" }, fmtEnergy(tot.calories, u, false), h("small", {}, ` ${u.energy}`)),
      h("div", { class: "tot-macros" }, `Protein ${round(tot.protein_g)} g · Carbs ${round(tot.carbs_g)} g · Fat ${round(tot.fat_g)} g`),
    );
    addBtn.disabled = !items.length;
  }

  addBtn.addEventListener("click", () => {
    const now = new Date();
    const when = viewDate === localDate() ? now : new Date(parseDate(viewDate).getTime() + 12 * 3600000);
    addEntry({ date: viewDate, time: when.getTime(), meal, name: nameInput.value.trim() || result.meal_name, thumb: opt.thumb, items: items.map(scaled) });
    review.close();
    draftText = "";
    render();
    toast(celebrate());
  });

  const parts: (Node | null)[] = [
    opt.preview ? h("img", { class: "review-photo", src: opt.preview, alt: "" }) : null,
    nameInput,
    opt.noBadge ? null : h("span", { class: `badge ${result.confidence}` }, `${result.confidence} confidence`),
    result.notes ? h("p", { class: "notes" }, result.notes) : null,
    itemsBox,
    h(
      "div",
      { class: "servings" },
      h("span", {}, "Servings"),
      h(
        "div",
        { class: "stepper" },
        h("button", { class: "icon-btn", "aria-label": "Fewer servings", onclick: () => { servings = Math.max(0.25, servings - 0.25); update(); } }, "−"),
        servingsLabel,
        h("button", { class: "icon-btn", "aria-label": "More servings", onclick: () => { servings += 0.25; update(); } }, "+"),
      ),
    ),
    totalsBox,
    segmented<MealType>(MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m].replace("Snacks", "Snack") })), meal, (v) => (meal = v), "Meal"),
    h("div", { class: "sheet-actions" }, h("button", { class: "btn ghost", onclick: () => review.close() }, "Cancel"), addBtn),
  ];
  $("review-body").replaceChildren(...parts.filter((p): p is Node => p !== null));
  update();
  if (!review.open) review.showModal();
}

function celebrate(): string {
  const name = settings.profile?.name;
  const plain = ["Added to your log ✅", "Logged! Nice one 👍", "Got it! 📒", "Saved to your day ✨"];
  const named = ["Nice one, {n}! 👍", "Logged, {n}! ✅", "Keep it up, {n}! 💪", "Great job tracking, {n}! ✨"];
  const pool = name ? [...plain, ...named] : plain;
  return pool[Math.floor(Math.random() * pool.length)].replace("{n}", name ?? "");
}

// ======================= barcode scanner =======================
const scanner = $("scanner") as HTMLDialogElement;
let scanControls: ScanControls | null = null;

function stopScanner() {
  scanControls?.stop();
  scanControls = null;
}
scanner.addEventListener("close", stopScanner);

function openScanner() {
  const video = h("video", { class: "scan-video", playsinline: "", muted: "", autoplay: "" });
  video.muted = true;
  const status = h("p", { class: "scan-status muted small" }, "Starting camera…");
  const codeInput = h("input", { type: "text", inputmode: "numeric", placeholder: "Or type the numbers under the barcode", autocomplete: "off", "aria-label": "Barcode number" });
  const form = h("form", { class: "text-form" }, codeInput, h("button", { type: "submit", class: "btn primary" }, "Look up"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (codeInput.value.trim()) handleCode(codeInput.value.trim());
  });
  const viewport = h("div", { class: "scan-viewport" }, video, h("div", { class: "scan-guide", "aria-hidden": "true" }));
  $("scanner-body").replaceChildren(
    h("h2", {}, "Scan a barcode"),
    viewport,
    status,
    form,
    h("div", { class: "sheet-actions" }, h("button", { class: "btn ghost", onclick: () => scanner.close() }, "Cancel")),
  );
  scanner.showModal();

  async function handleCode(code: string) {
    stopScanner();
    viewport.classList.add("found");
    status.textContent = `Found ${code}. Looking it up…`;
    try {
      const found = await lookupBarcode(code);
      if (!found) {
        status.replaceChildren(
          "We couldn't find that product. ",
          h("button", { class: "link-btn", onclick: () => { scanner.close(); photoInput.click(); } }, "Snap the nutrition label instead"),
          " and the AI will read it.",
        );
        return;
      }
      scanner.close();
      showReview(found.analysis, { thumb: found.image, preview: found.image, noBadge: true });
    } catch (err) {
      status.textContent = err instanceof LookupError ? err.message : "Something went wrong. Try again.";
    }
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "This browser can't use the camera here. Type the barcode number instead.";
    viewport.hidden = true;
    return;
  }
  startScanner(video, handleCode)
    .then((c) => {
      if (!scanner.open) return c.stop();
      scanControls = c;
      status.textContent = "Point the camera at the barcode. Hold steady about a hand's width away.";
    })
    .catch((err: unknown) => {
      viewport.hidden = true;
      const name = err instanceof Error ? err.name : "";
      status.textContent =
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow camera access for this site in Settings → Safari → Camera, or type the barcode number."
          : "Couldn't start the camera. Type the barcode number instead.";
    });
}

// ======================= weight dialog =======================
const mini = $("mini") as HTMLDialogElement;

function openWeightDialog() {
  const u = U();
  const latest = allWeights().at(-1);
  const startKg = latest?.kg ?? settings.profile?.weightKg;
  const input = h("input", { type: "number", inputmode: "decimal", step: "0.1", value: startKg ? (Math.round(weightValue(startKg, u) * 10) / 10).toString() : "" });
  const dateInput = h("input", { type: "date", value: localDate(), max: localDate() });
  const list = h("div", { class: "weight-list" });
  const drawList = () => {
    const recent = allWeights().slice(-6).reverse();
    list.replaceChildren(
      ...recent.map((w) =>
        h(
          "div",
          { class: "weight-row" },
          h("span", {}, parseDate(w.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })),
          h("span", {}, fmtWeight(w.kg, u)),
          h("button", { class: "icon-btn remove", "aria-label": `Delete weight from ${w.date}`, onclick: () => { deleteWeight(w.date); syncWeight(); drawList(); render(); } }, "×"),
        ),
      ),
    );
  };
  drawList();
  $("mini-body").replaceChildren(
    h("h2", {}, "Log weight"),
    h("div", { class: "field-row" }, h("label", { class: "field" }, h("span", {}, `Weight (${u.weight})`), input), h("label", { class: "field" }, h("span", {}, "Date"), dateInput)),
    h("p", { class: "muted small" }, "Tip: weigh yourself at the same time of day, like right after waking up. Daily ups and downs are normal; the trend is what counts."),
    list,
    h(
      "div",
      { class: "sheet-actions" },
      h("button", { class: "btn ghost", onclick: () => mini.close() }, "Close"),
      h(
        "button",
        {
          class: "btn primary",
          onclick: () => {
            const kg = weightToKg(parseFloat(input.value), u);
            if (!(kg >= 30 && kg <= 300)) return toast("Please enter a valid weight.");
            logWeight(dateInput.value || localDate(), kg);
            syncWeight();
            mini.close();
            render();
            toast("Weight saved ⚖️");
          },
        },
        "Save",
      ),
    ),
  );
  mini.showModal();
}

/** Keep the profile's weight in step with the latest logged weight, and refresh targets. */
function syncWeight() {
  const latest = allWeights().at(-1);
  if (latest && settings.profile) {
    settings.profile.weightKg = latest.kg;
    recomputeTargets();
    save();
  }
}

// ======================= settings =======================
function renderSettings() {
  const root = $("view-settings");
  const u = U();
  const p = settings.profile;
  const rerender = () => { save(); render(); };

  const section = (title: string, ...children: (Node | null)[]) => h("section", { class: "card settings-card" }, h("h3", {}, title), ...children.filter((c): c is Node => c !== null));

  // Profile
  const profileCard = section(
    "Profile",
    p
      ? h(
          "div",
          { class: "profile-summary" },
          h("div", { class: "avatar", "aria-hidden": "true" }, (p.name[0] || "?").toUpperCase()),
          h(
            "div",
            {},
            h("div", { class: "profile-name" }, p.name),
            h("div", { class: "muted small" }, `${p.age} · ${p.sex === "other" ? "Other" : p.sex === "male" ? "Male" : "Female"} · ${fmtHeight(p.heightCm, u)} · ${fmtWeight(p.weightKg, u)}`),
            h("div", { class: "muted small" }, `${GOALS[p.goal].emoji} ${GOALS[p.goal].label} · ${ACTIVITY[p.activity].label}`),
          ),
        )
      : h("p", { class: "muted" }, "No profile yet."),
    h("button", { class: "btn wide", onclick: editProfile }, p ? "Edit profile & goal" : "Set up profile"),
    h("button", { class: "btn wide ghost", onclick: openWeightDialog }, "⚖️ Log weight"),
  );

  // Targets
  const tgt = settings.targets;
  const targetFields: [keyof Targets, string, string][] = [
    ["calories", "Calories", "kcal"],
    ["protein", "Protein", "g"],
    ["carbs", "Carbs", "g"],
    ["fat", "Fat", "g"],
    ["fiber", "Fiber", "g"],
    ["waterMl", "Water", "ml"],
  ];
  const auto = settings.autoTargets && !!p;
  const plan = p ? makePlan(p) : null;
  const targetsCard = section(
    "Daily targets",
    toggle("Automatic", auto, (v) => { settings.autoTargets = v; recomputeTargets(); rerender(); }, p ? "Worked out from your profile and goal" : "Set up your profile first"),
    h(
      "div",
      { class: "target-grid" },
      ...targetFields.map(([k, label, unit]) => {
        const input = h("input", { type: "number", inputmode: "numeric", value: String(tgt[k]), disabled: auto });
        input.addEventListener("change", () => {
          const v = Math.round(Number(input.value));
          if (v > 0) {
            settings.targets = { ...settings.targets, [k]: v };
            save();
          }
        });
        return h("label", { class: "field" }, h("span", {}, `${label} (${unit})`), input);
      }),
    ),
    plan && auto
      ? h(
          "details",
          { class: "why" },
          h("summary", {}, "How these were worked out"),
          ...plan.notes.map((n) => h("p", { class: "plan-note" }, "⚠️ ", n)),
          ...plan.why.map((w) => h("div", { class: "why-item" }, h("strong", {}, w.title), h("p", {}, w.text))),
        )
      : null,
  );

  // Units
  const unitsCard = section(
    "Units",
    unitRow("Weight", segmented([{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }], u.weight, (v) => { u.weight = v; rerender(); }, "Weight unit")),
    unitRow("Height", segmented([{ value: "cm", label: "cm" }, { value: "ftin", label: "ft / in" }], u.height, (v) => { u.height = v; rerender(); }, "Height unit")),
    unitRow("Energy", segmented([{ value: "kcal", label: "kcal" }, { value: "kJ", label: "kJ" }], u.energy, (v) => { u.energy = v; rerender(); }, "Energy unit")),
    unitRow("Water", segmented([{ value: "ml", label: "ml / L" }, { value: "floz", label: "fl oz" }], u.water, (v) => { u.water = v; rerender(); }, "Water unit")),
  );

  // Appearance
  const appearanceCard = section(
    "Appearance",
    unitRow("Theme", segmented([{ value: "auto", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }], settings.theme, (v) => { settings.theme = v; applyTheme(); save(); }, "Theme")),
    h(
      "div",
      { class: "unit-row" },
      h("span", {}, "Color"),
      h(
        "div",
        { class: "swatches", role: "radiogroup", "aria-label": "Accent color" },
        ...ACCENTS.map((a) => h("button", { class: `swatch sw-${a}`, role: "radio", "aria-checked": String(settings.accent === a), "aria-label": a, onclick: () => { settings.accent = a; applyTheme(); rerender(); } })),
      ),
    ),
  );

  // Features
  const featuresCard = section(
    "Features",
    toggle("Motivation messages", settings.showMotivation, (v) => { settings.showMotivation = v; save(); }, "A personal message at the top of Today"),
    toggle("Water tracker", settings.showWater, (v) => { settings.showWater = v; save(); }),
    unitRow(
      u.water === "ml" ? "Glass (ml)" : "Glass (fl oz)",
      segmented(
        [200, 250, 330, 500].map((ml) => ({ value: String(ml), label: u.water === "ml" ? `${ml}` : `${Math.round(ml / 29.5735)}` })),
        String(settings.glassMl),
        (v) => { settings.glassMl = Number(v); save(); },
        "Glass size",
      ),
    ),
  );

  // AI key
  const keyInput = h("input", { type: "password", value: settings.apiKey, placeholder: "AIza...", autocomplete: "off" });
  const aiCard = section(
    "Free AI",
    h("label", { class: "field" }, h("span", {}, settings.apiKey ? "Google AI key ✓ saved" : "Google AI key"), keyInput),
    h("button", { class: "btn wide primary", onclick: () => { settings.apiKey = keyInput.value.trim(); save(); render(); toast(settings.apiKey ? "Key saved 🔑" : "Key removed"); } }, "Save key"),
    h("p", { class: "muted small" }, "Free, no credit card: sign in at ", h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "aistudio.google.com/apikey"), " and tap “Create API key”. 🔒 Saved only on this phone and only sent to Google."),
  );

  // Data
  const restoreInput = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  restoreInput.addEventListener("change", async () => {
    const f = restoreInput.files?.[0];
    restoreInput.value = "";
    if (!f) return;
    if (!confirm("Restoring replaces everything on this phone with the backup. Continue?")) return;
    try {
      importBackup(await f.text(), settings.apiKey);
      location.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't restore that file.");
    }
  });
  const dataCard = section(
    "Your data",
    h("p", { class: "muted small" }, "Everything is stored only on this phone. Back up now and then so you don't lose it if Safari's data gets cleared. Backups never include your AI key."),
    h("button", { class: "btn wide", onclick: () => download(`foodchecker-backup-${localDate()}.json`, exportBackup(settings), "application/json") }, "💾 Back up everything"),
    h("button", { class: "btn wide", onclick: () => restoreInput.click() }, "📂 Restore from backup"),
    h("button", { class: "btn wide", onclick: () => download(`foodchecker-${localDate()}.csv`, exportCsv(), "text/csv") }, "📊 Export food log (CSV)"),
    h(
      "button",
      {
        class: "btn wide danger",
        onclick: () => {
          if (!confirm("Delete ALL your meals, weights, settings and your key from this phone?")) return;
          if (!confirm("Are you really sure? This can't be undone.")) return;
          resetEverything();
          location.reload();
        },
      },
      "Delete everything",
    ),
    restoreInput,
  );

  const about = h(
    "p",
    { class: "footer-note" },
    "FoodChecker · AI estimates are a guide, not medical advice. If you have a health condition, are pregnant, or have a history of disordered eating, talk to a doctor before changing how you eat.",
  );

  root.replaceChildren(h("h1", { class: "page-title" }, "Settings"), profileCard, targetsCard, unitsCard, appearanceCard, featuresCard, aiCard, dataCard, about);
}

function unitRow(label: string, control: HTMLElement) {
  return h("div", { class: "unit-row" }, h("span", {}, label), control);
}

function editProfile() {
  runOnboarding({
    profile: settings.profile,
    units: settings.units,
    apiKey: settings.apiKey,
    firstRun: !settings.onboarded,
    onDone: finishOnboarding,
  });
}

function finishOnboarding(r: OnboardingResult) {
  const first = !settings.onboarded;
  const weightChanged = !settings.profile || Math.abs(settings.profile.weightKg - r.profile.weightKg) > 0.05;
  settings.profile = r.profile;
  settings.units = r.units;
  settings.apiKey = r.apiKey;
  settings.onboarded = true;
  if (first) settings.autoTargets = true;
  recomputeTargets();
  if (weightChanged) logWeight(localDate(), r.profile.weightKg);
  save();
  render();
  toast(first ? `You're all set, ${r.profile.name}! 🎉` : "Profile updated ✅");
}

// ======================= wiring =======================
for (const b of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  b.addEventListener("click", () => setTab(b.dataset.tab as typeof tab));
}

const photoInput = $<HTMLInputElement>("photo-input");
photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  if (file) runAnalysis({ file, text: draftText });
});

for (const dlg of [review, mini, scanner]) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg && !dlg.querySelector(".loading")) dlg.close();
  });
}

// Re-render when the app comes back to the foreground (e.g. on a new day).
let lastDay = localDate();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const today = localDate();
  if (today !== lastDay && viewDate === lastDay) viewDate = today;
  lastDay = today;
  render();
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

applyTheme();
render();
if (!settings.onboarded) setTimeout(editProfile, 300);

// Ask the browser to keep this app's data even when the phone is low on space.
navigator.storage?.persist?.().catch(() => {});
