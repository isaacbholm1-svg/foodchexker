import "./style.css";
import { analyzeMeal, AnalysisError, suggestIdeas, type Analysis, type FoodItem, type Idea } from "./ai";
import { renderChat } from "./chat";
import { registerMorePage, renderMore, openMorePage, currentMorePage } from "./more";
import { FEATURES, featureOn, setFeature, setFeatureSource, type FeatureId } from "./features";
import { renderRecipes, renderShopping } from "./recipes";
import { renderPlanner } from "./planner";
import { FEEDBACK_ACCESS_KEY } from "./config";
import { BADGES, badgeDesc, badgeName, dayScore, earnedBadges, type ScorePart } from "./badges";
import { confetti, countUp, replay } from "./fx";
import { LookupError, lookupBarcode, startScanner, type ScanControls } from "./barcode";
import { prepareImage } from "./image";
import { motivation } from "./motivation";
import { LANGUAGES, celebrateLines, detectLanguage, getLanguage, locale, setLanguage, t, tips, type StringKey } from "./i18n";
import { GOAL_EMOJI, activitySummary, energyValue, fmtEnergy, fmtHeight, fmtWater, fmtWeight, goalLabel, makePlan, weightToKg, weightValue } from "./nutrition";
import { runOnboarding, type OnboardingResult } from "./onboarding";
import { currentStreak, renderStats, type Range } from "./stats";
import {
  addDays,
  addEntry,
  allFavorites,
  allWeights,
  deleteEntry,
  deleteWeight,
  entriesFor,
  exportBackup,
  exportCsv,
  guessMeal,
  importBackup,
  isFavorite,
  markBadgesSeen,
  loadSettings,
  localDate,
  logWeight,
  parseDate,
  recentMeals,
  resetEverything,
  saveSettings,
  seenBadges,
  setWater,
  toggleFavorite,
  updateEntry,
  waterFor,
  type Entry,
  type EntrySource,
  type MealType,
  type Settings,
  type Targets,
} from "./store";
import { $, download, h, segmented, toast, toggle } from "./ui";

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const mealLabel = (m: MealType) => t(m === "snack" ? "snacks" : m);
const ACCENTS: Settings["accent"][] = ["green", "blue", "purple", "pink", "orange", "teal"];

let settings = loadSettings();
setFeatureSource(() => settings);
setLanguage(settings.language ?? detectLanguage());
let viewDate = localDate();
let tab: "today" | "chat" | "stats" | "more" | "settings" = "today";
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
function applyFeatureTabs() {
  const chatTab = document.querySelector<HTMLElement>(".tab[data-tab=chat]");
  if (chatTab) chatTab.hidden = !featureOn("chat");
}

function setTab(t: typeof tab) {
  if (t === "chat" && !featureOn("chat")) t = "today";
  if (t === "today") animateIn = true;
  tab = t;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    if (b.dataset.tab === (t === "settings" ? "more" : t)) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  $("view-today").hidden = t !== "today";
  $("view-chat").hidden = t !== "chat";
  $("view-stats").hidden = t !== "stats";
  $("view-more").hidden = t !== "more";
  $("view-settings").hidden = t !== "settings";
  render();
  replay($(`view-${t}`), "view-in");
  window.scrollTo({ top: 0 });
}

function render() {
  if (tab === "today") renderToday();
  else if (tab === "chat") renderChat($("view-chat"), { apiKey: settings.apiKey, context: chatContext, openSettings: () => setTab("settings") });
  else if (tab === "stats") renderStats($("view-stats"), settings, statsRange, (r) => { statsRange = r; render(); }, openWeightDialog);
  else if (tab === "more") renderMore($("view-more"), () => null, render);
  else renderSettings();
}

// ======================= today =======================
function dayLabel(date: string): string {
  const today = localDate();
  if (date === today) return t("today");
  if (date === addDays(today, -1)) return t("yesterday");
  return parseDate(date).toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" });
}

// ---- Today-screen state for animations ----
let animateIn = true; // play the card entrance animation on the next Today render
let highlightId: string | null = null; // a just-added meal row to highlight
let lastShown = { date: "", eaten: 0, left: 0, frac: 0, bars: {} as Record<string, number> };
let pendingMeal: MealType | null = null; // meal chosen with a "+ Add" button
let waterPop = false;
let tipOffset = 0;

const SPARKLE_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M10 2.5c.45 4.1 2.4 6.05 6.5 6.5-4.1.45-6.05 2.4-6.5 6.5-.45-4.1-2.4-6.05-6.5-6.5 4.1-.45 6.05-2.4 6.5-6.5Z"/><path fill="currentColor" d="M18.5 13.5c.25 2.25 1.25 3.25 3.5 3.5-2.25.25-3.25 1.25-3.5 3.5-.25-2.25-1.25-3.25-3.5-3.5 2.25-.25 3.25-1.25 3.5-3.5Z"/></svg>';

function aiBadge(): HTMLElement {
  const b = h("span", { class: "ai-badge" });
  b.innerHTML = SPARKLE_SVG;
  b.append(t("aiPowered"));
  return b;
}

function renderToday() {
  const root = $("view-today");
  const u = U();
  const tg = settings.targets;
  const isToday = viewDate === localDate();
  const entries = entriesFor(viewDate);
  const allItems = entries.flatMap((e) => e.items);
  const totals = sum(allItems);
  const fiber = allItems.reduce((a, i) => a + i.fiber_g, 0);
  const sugar = allItems.reduce((a, i) => a + i.sugar_g, 0);
  const waterMl = waterFor(viewDate);
  const streak = currentStreak();
  const same = lastShown.date === viewDate;

  // --- header ---
  const header = h(
    "header",
    { class: "topbar" },
    h("button", { class: "icon-btn", "aria-label": t("prevDay"), onclick: () => goDay(-1) }, "‹"),
    h("button", { class: "day-label", onclick: () => { viewDate = localDate(); animateIn = true; render(); } }, dayLabel(viewDate)),
    h("button", { class: "icon-btn", "aria-label": t("nextDay"), disabled: isToday, onclick: () => goDay(1) }, "›"),
    streak > 0 && featureOn("streak") ? h("span", { class: "streak-pill", "aria-label": t("streakAria", { n: streak }) }, h("span", { class: "flame" }, "🔥"), String(streak)) : null,
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
        streak,
        entriesToday: entries.length,
        isToday,
        weekday: parseDate(viewDate).getDay(),
        seed: motivationSeed,
      },
      viewDate,
    );
    const textEl = h("span", { class: "moti-text" }, m.text);
    moti = h(
      "button",
      {
        class: "card motivation",
        "aria-label": t("motiAria", { text: m.text }),
        onclick: () => {
          motivationSeed++;
          render();
          replay($("view-today").querySelector(".motivation")!, "flip");
        },
      },
      h("span", { class: "moti-emoji", "aria-hidden": "true" }, m.emoji),
      textEl,
    );
  }

  // --- summary ring + macros (animated from the last values shown) ---
  const left = tg.calories - totals.calories;
  const frac = Math.min(totals.calories / (tg.calories || 1), 1);
  const C = 2 * Math.PI * 52;
  const ringSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ringSvg.setAttribute("viewBox", "0 0 120 120");
  ringSvg.setAttribute("class", "ring");
  ringSvg.setAttribute("aria-hidden", "true");
  const startFrac = same ? lastShown.frac : 0;
  ringSvg.innerHTML = `<circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-fill${left < 0 ? " over" : ""}" cx="60" cy="60" r="52" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - startFrac)}"/>`;
  const ringFill = ringSvg.querySelector<SVGCircleElement>(".ring-fill")!;
  requestAnimationFrame(() => requestAnimationFrame(() => (ringFill.style.strokeDashoffset = String(C * (1 - frac)))));

  const ringNum = h("div", { class: fmtEnergy(Math.abs(left), u, false).length > 5 ? "ring-num long" : "ring-num" });
  countUp(ringNum, same ? Math.abs(lastShown.left) : Math.abs(tg.calories), Math.abs(left), (n) => fmtEnergy(n, u, false));
  const eatenNum = h("span", {});
  countUp(eatenNum, same ? lastShown.eaten : 0, totals.calories, (n) => fmtEnergy(n, u, false));

  const bars: Record<string, number> = {};
  const macro = (label: string, key: string, val: number, goal: number) => {
    const pct = Math.min((val / (goal || 1)) * 100, 100);
    bars[key] = pct;
    const fill = h("div", { class: "bar-fill", style: `width:${same ? (lastShown.bars[key] ?? 0) : 0}%` });
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${pct}%`)));
    return h(
      "div",
      { class: "macro", "data-macro": key },
      h("div", { class: "macro-head" }, h("span", {}, label), h("span", { class: "macro-val" }, `${round(val)} / ${goal} g`)),
      h("div", { class: "bar" }, fill),
    );
  };

  const score = featureOn("score") ? dayScore(entries, waterMl, settings) : null;
  const summary = h(
    "section",
    { class: "card summary-card" },
    h(
      "div",
      { class: "summary" },
      h("div", { class: "ring-wrap" }, ringSvg, h("div", { class: "ring-text" }, ringNum, h("div", { class: "ring-sub" }, `${u.energy} ${left < 0 ? t("over") : t("left")}`))),
      h(
        "div",
        { class: "summary-side" },
        h("div", { class: "eaten" }, eatenNum, ` / ${fmtEnergy(tg.calories, u)}`),
        macro(t("protein"), "protein", totals.protein_g, tg.protein),
        macro(t("carbs"), "carbs", totals.carbs_g, tg.carbs),
        macro(t("fat"), "fat", totals.fat_g, tg.fat),
      ),
    ),
    h(
      "div",
      { class: "summary-foot" },
      h("span", { class: "muted small" }, t("fiberSugar", { f: round(fiber), ft: tg.fiber, s: round(sugar) })),
      score
        ? h(
            "button",
            { class: `score-chip s${score.score >= 80 ? "hi" : score.score >= 55 ? "mid" : "lo"}`, onclick: () => openScore(score) },
            h("span", { class: "score-num" }, String(score.score)),
            h("span", {}, t("dayScore")),
          )
        : null,
    ),
  );
  lastShown = { date: viewDate, eaten: totals.calories, left, frac, bars };

  // --- add food ---
  const textInput = h("input", { id: "text-input", type: "text", placeholder: t("describePlaceholder"), autocomplete: "off", enterkeyhint: "go", value: draftText, "aria-label": t("describeAria") });
  textInput.addEventListener("input", () => (draftText = textInput.value));
  const form = h("form", { class: "text-form" }, textInput, h("button", { type: "submit", class: "btn primary" }, t("analyze")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return textInput.focus();
    textInput.blur();
    runAnalysis({ text });
  });
  const favs = allFavorites();
  const recents = recentMeals(10);
  const chipRow = (title: string, list: { name: string; thumb?: string }[], onPick: (i: number) => void) =>
    h(
      "div",
      { class: "recents" },
      h("div", { class: "muted small recents-title" }, title),
      h("div", { class: "chips" }, ...list.map((e, i) => h("button", { class: "chip", onclick: () => onPick(i) }, e.thumb ? h("img", { src: e.thumb, alt: "" }) : null, h("span", {}, e.name)))),
    );
  const add = h(
    "section",
    { class: "card add", "aria-label": t("addFood") },
    h("label", { class: "snap-btn", for: "photo-input" }, h("span", { class: "cam", "aria-hidden": "true" }, "📷"), h("span", {}, t("snapPhoto"))),
    h(
      "div",
      { class: "add-row" },
      featureOn("scanner") ? h("button", { type: "button", class: "scan-btn", onclick: openScanner }, h("span", { class: "barcode-icon", "aria-hidden": "true" }), h("span", {}, t("scanBarcode"))) : null,
      featureOn("quickadd") ? h("button", { type: "button", class: "scan-btn quick-btn", onclick: () => openQuickAdd() }, h("span", {}, t("quickAdd"))) : null,
    ),
    h("div", { class: "or" }, t("orDescribe")),
    form,
    favs.length && featureOn("quickadd") ? chipRow(t("favorites"), favs, (i) => showReview({ meal_name: favs[i].name, items: favs[i].items.map((x) => ({ ...x })), confidence: "high", notes: "" }, { thumb: favs[i].thumb, preview: favs[i].thumb, noBadge: true, source: "favorite" })) : null,
    recents.length && featureOn("quickadd") ? chipRow(t("logAgainNoAi"), recents, (i) => reLog(recents[i])) : null,
  );

  // --- suggestions + AI ideas ---
  const sugg = isToday && featureOn("suggestions") ? suggestionsCard({ entries, totals, fiber, sugar, waterMl }) : null;

  // --- water ---
  let waterCard: HTMLElement | null = null;
  if (settings.showWater) {
    const glasses = Math.round(waterMl / settings.glassMl);
    const goalGlasses = Math.max(1, Math.round(tg.waterMl / settings.glassMl));
    waterCard = h(
      "section",
      { class: "card water" },
      h("div", { class: "card-head" }, h("h3", {}, t("waterTitle")), h("span", { class: "muted" }, `${fmtWater(waterMl, u)} / ${fmtWater(tg.waterMl, u)}`)),
      h(
        "div",
        { class: "water-row" },
        h("button", { class: "round-btn", "aria-label": t("removeGlass"), onclick: () => { setWater(viewDate, waterMl - settings.glassMl); render(); } }, "−"),
        h(
          "div",
          { class: "glasses", role: "img", "aria-label": t("glassesAria", { n: glasses, m: goalGlasses }) },
          ...Array.from({ length: Math.min(16, Math.max(goalGlasses, glasses)) }, (_, i) => h("span", { class: `glass${i < glasses ? " full" : ""}${waterPop && i === glasses - 1 ? " pop" : ""}` })),
        ),
        h(
          "button",
          {
            class: "round-btn primary",
            "aria-label": t("addGlass"),
            onclick: (ev: MouseEvent) => {
              setWater(viewDate, waterMl + settings.glassMl);
              waterPop = true;
              if (waterMl + settings.glassMl >= tg.waterMl && waterMl < tg.waterMl) {
                toast(settings.profile ? t("waterGoalReachedName", { name: settings.profile.name }) : t("waterGoalReached"));
                confetti({ x: ev.clientX, y: ev.clientY, count: 70 });
              }
              render();
              checkBadges();
            },
          },
          "+",
        ),
      ),
      h("div", { class: "muted small" }, t("oneGlass", { amount: fmtWater(settings.glassMl, u) })),
    );
    waterPop = false;
  }

  // --- log: every meal has its own section with an add button ---
  const log = h("section", { class: "log", "aria-label": t("progress") });
  for (const meal of MEALS) {
    const list = entries.filter((e) => e.meal === meal);
    const kcal = sum(list.flatMap((e) => e.items)).calories;
    log.append(
      h(
        "div",
        { class: `card meal-group${list.length ? "" : " empty-meal"}` },
        h(
          "div",
          { class: "meal-head" },
          h("h3", {}, `${MEAL_EMOJI[meal]} ${mealLabel(meal)}`),
          h("span", { class: "muted" }, list.length ? fmtEnergy(kcal, u) : ""),
          h("button", { class: "add-mini", "aria-label": t("addTo", { meal: mealLabel(meal) }), onclick: () => openAddSheet(meal) }, "+"),
        ),
        ...list.map(renderEntry),
      ),
    );
  }

  // --- tip of the day ---
  const allTips = tips();
  const dayIndex = Math.floor(parseDate(viewDate).getTime() / 86400000);
  const tip = allTips[(((dayIndex + tipOffset) % allTips.length) + allTips.length) % allTips.length];
  const tipSpace = tip.indexOf(" ");
  const tipCard = !featureOn("tips") ? null : h(
    "button",
    { class: "card tip-card", onclick: () => { tipOffset++; render(); replay($("view-today").querySelector(".tip-card")!, "flip"); } },
    h("span", { class: "tip-emoji", "aria-hidden": "true" }, tip.slice(0, tipSpace)),
    h("span", { class: "tip-body" }, h("span", { class: "tip-title" }, t("tipTitle")), h("span", {}, tip.slice(tipSpace + 1))),
  );

  root.replaceChildren(
    ...[header, moti, summary, add, sugg, waterCard, log, tipCard, h("p", { class: "footer-note" }, t("aiDisclaimer"))].filter((n): n is HTMLElement => !!n),
  );
  root.classList.toggle("stagger", animateIn);
  animateIn = false;
  if (highlightId) {
    root.querySelector(`[data-id="${highlightId}"]`)?.classList.add("just-added");
    highlightId = null;
  }
}

const MEAL_EMOJI: Record<MealType, string> = { breakfast: "🍳", lunch: "🥪", dinner: "🍝", snack: "🍎" };

function goDay(delta: number) {
  const next = addDays(viewDate, delta);
  if (next > localDate()) return;
  viewDate = next;
  animateIn = false;
  render();
  replay($("view-today"), delta < 0 ? "slide-right" : "slide-left");
}

// ---------------- suggestions & AI ideas ----------------
const IDEAS_KEY = "fc.ideas.v1";
let ideasState: { key: string; ideas: Idea[] | null; loading: boolean; failed: boolean } = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(IDEAS_KEY) || "null");
    if (saved?.key && Array.isArray(saved.ideas)) return { key: saved.key, ideas: saved.ideas, loading: false, failed: false };
  } catch {
    /* ignore */
  }
  return { key: "", ideas: null, loading: false, failed: false };
})();

function suggestionsCard(ctx: { entries: Entry[]; totals: ReturnType<typeof sum>; fiber: number; sugar: number; waterMl: number }): HTMLElement {
  const tg = settings.targets;
  const u = U();
  const hour = new Date().getHours();
  const goal = settings.profile?.goal ?? "maintain";
  const growth = goal === "gain" || goal === "muscle";
  const left = tg.calories - ctx.totals.calories;
  const tips: string[] = [];
  const push = (s: string) => tips.length < 2 && tips.push(s);
  if (hour >= 19 && ctx.totals.calories < tg.calories * 0.6 && !growth) push(t("sug_eat_enough"));
  if (left < -tg.calories * 0.05 && !growth) push(t("sug_over"));
  if (!ctx.entries.some((e) => e.meal === "breakfast") && hour < 11) push(t("sug_breakfast"));
  if (tg.protein - ctx.totals.protein_g > 25 && hour >= 11) push(t("sug_protein", { n: round(tg.protein - ctx.totals.protein_g) }));
  if (growth && left > 500 && hour >= 15) push(t("sug_gain"));
  if (tg.fiber - ctx.fiber > 8 && hour >= 13) push(t("sug_fiber", { n: round(tg.fiber - ctx.fiber) }));
  if (ctx.sugar > (tg.calories * 0.1) / 4) push(t("sug_sugar"));
  if (settings.showWater && hour >= 12 && ctx.waterMl < tg.waterMl) push(t("sug_water", { n: fmtWater(tg.waterMl - ctx.waterMl, u) }));
  if (left > 400) push(t("sug_meal_left", { n: fmtEnergy(left, u) }));
  else if (left > 150) push(t("sug_snack"));
  if (!tips.length && ctx.entries.length) push(t("sug_all_good"));

  const card = h("section", { class: "card sugg-card", id: "sugg-card" }, h("div", { class: "card-head" }, h("h3", {}, t("sugTitle"))));
  for (const s of tips) card.append(h("p", { class: "sugg-line" }, s));

  // AI ideas
  const ideasBox = h("div", { class: "ideas" });
  const refresh = h("button", { class: "icon-btn refresh-btn", "aria-label": t("newIdeas"), title: t("newIdeas"), onclick: () => loadIdeas(true) }, "↻");
  card.append(h("div", { class: "ideas-head" }, h("span", { class: "ideas-title" }, t("ideasTitle")), aiBadge(), settings.apiKey ? refresh : null), ideasBox);

  if (!settings.apiKey) {
    ideasBox.append(h("p", { class: "muted small" }, t("ideasNeedKey")));
    return card;
  }
  const key = `${viewDate}|${Math.round(ctx.totals.calories / 150)}|${getLanguage()}`;
  if (ideasState.key !== key && !ideasState.loading) loadIdeas(false, key, ctx);
  if (ideasState.loading || ideasState.key !== key) {
    ideasBox.append(
      h("p", { class: "muted small ideas-loading" }, h("span", { class: "sparkle-spin" }), t("ideasLoading")),
      ...[0, 1, 2].map(() => h("div", { class: "idea skeleton" }, h("span", { class: "sk sk-emoji" }), h("span", { class: "sk-lines" }, h("span", { class: "sk sk-1" }), h("span", { class: "sk sk-2" })))),
    );
  } else if (ideasState.failed || !ideasState.ideas?.length) {
    ideasBox.append(h("p", { class: "muted small" }, t("ideasFailed")));
  } else {
    ideasBox.append(
      ...ideasState.ideas.map((idea, i) =>
        h(
          "button",
          { class: "idea", style: `animation-delay:${i * 90}ms`, onclick: () => runAnalysis({ text: `${idea.title}. ${idea.detail}` }) },
          h("span", { class: "idea-emoji", "aria-hidden": "true" }, idea.emoji),
          h("span", { class: "idea-text" }, h("span", { class: "idea-title" }, idea.title), h("span", { class: "muted small" }, idea.detail)),
          idea.calories ? h("span", { class: "idea-kcal" }, fmtEnergy(idea.calories, u)) : null,
        ),
      ),
    );
  }
  return card;

  function loadIdeas(force: boolean, k = key, c = ctx) {
    if (ideasState.loading) return;
    ideasState = { key: force ? "" : ideasState.key, ideas: force ? null : ideasState.ideas, loading: true, failed: false };
    if (force) render();
    const eaten = c.entries.map((e) => e.name).slice(-8);
    const nextMeal = hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "evening snack";
    suggestIdeas({
      apiKey: settings.apiKey,
      hour,
      goal: settings.profile ? goalLabel(goal) : "eat balanced",
      age: settings.profile?.age,
      kcalLeft: settings.targets.calories - c.totals.calories,
      proteinLeft: Math.max(0, settings.targets.protein - c.totals.protein_g),
      fiberLeft: Math.max(0, settings.targets.fiber - c.fiber),
      nextMeal,
      eatenToday: eaten,
    })
      .then((ideas) => {
        ideasState = { key: k, ideas, loading: false, failed: false };
        try {
          localStorage.setItem(IDEAS_KEY, JSON.stringify({ key: k, ideas }));
        } catch {
          /* ignore */
        }
      })
      .catch(() => (ideasState = { key: k, ideas: null, loading: false, failed: true }))
      .finally(() => {
        if (tab === "today" && viewDate === localDate()) {
          const old = document.getElementById("sugg-card");
          if (old) {
            const s = summaryForSuggestions();
            old.replaceWith(suggestionsCard(s));
          }
        }
      });
  }
}

function summaryForSuggestions() {
  const entries = entriesFor(viewDate);
  const items = entries.flatMap((e) => e.items);
  return { entries, totals: sum(items), fiber: items.reduce((a, i) => a + i.fiber_g, 0), sugar: items.reduce((a, i) => a + i.sugar_g, 0), waterMl: waterFor(viewDate) };
}

// ---------------- day score sheet ----------------
function openScore(score: { score: number; parts: ScorePart[] }) {
  $("mini-body").replaceChildren(
    h("div", { class: "score-hero" }, h("div", { class: `score-big s${score.score >= 80 ? "hi" : score.score >= 55 ? "mid" : "lo"}` }, String(score.score)), h("h2", {}, t("scoreTitle", { n: score.score }))),
    ...score.parts.map((p) =>
      h(
        "div",
        { class: "score-row" },
        h("span", {}, `${p.points >= p.max * 0.8 ? "✅" : p.points > 0 ? "🟡" : "⚪"} ${t(p.key)}`),
        h("span", { class: "muted" }, `${p.points}/${p.max}`),
      ),
    ),
    h("p", { class: "muted small" }, t("scoreHint")),
    h("div", { class: "sheet-actions" }, h("button", { class: "btn primary", onclick: () => mini.close() }, t("close"))),
  );
  mini.showModal();
}

// ---------------- "+ Add" sheet for a meal ----------------
function openAddSheet(meal: MealType) {
  pendingMeal = meal;
  const opt = (emoji: string, label: string, onclick: () => void) => h("button", { class: "add-option", onclick }, h("span", { class: "add-option-emoji" }, emoji), h("span", {}, label));
  $("mini-body").replaceChildren(
    h("h2", {}, t("addTo", { meal: mealLabel(meal) })),
    h("p", { class: "muted" }, t("howAdd")),
    h(
      "div",
      { class: "add-options" },
      opt("📷", t("snapPhoto"), () => { mini.close(); photoInput.click(); }),
      featureOn("scanner") ? opt("▥", t("scanBarcode"), () => { mini.close(); openScanner(); }) : null,
      opt("💬", t("describeIt"), () => { mini.close(); const i = document.getElementById("text-input") as HTMLInputElement | null; i?.scrollIntoView({ block: "center", behavior: "smooth" }); i?.focus(); }),
      featureOn("quickadd") ? opt("✏️", t("quickAddTitle"), () => { mini.close(); openQuickAdd(meal); }) : null,
    ),
    h("div", { class: "sheet-actions" }, h("button", { class: "btn ghost", onclick: () => { pendingMeal = null; mini.close(); } }, t("cancel"))),
  );
  mini.showModal();
}

// ---------------- quick add (no AI) ----------------
function openQuickAdd(meal?: MealType) {
  const u = U();
  let chosen: MealType = meal ?? pendingMeal ?? (viewDate === localDate() ? guessMeal() : "snack");
  const name = h("input", { type: "text", placeholder: t("quickNamePh"), autocomplete: "off" });
  const kcal = h("input", { type: "number", inputmode: "numeric", placeholder: "0" });
  const grams = (label: string) => {
    const i = h("input", { type: "number", inputmode: "decimal", placeholder: t("optional") });
    return { input: i, field: h("label", { class: "field" }, h("span", {}, `${label} (g)`), i) };
  };
  const p = grams(t("protein"));
  const c = grams(t("carbs"));
  const f = grams(t("fat"));
  $("mini-body").replaceChildren(
    h("h2", {}, t("quickAddTitle")),
    h("p", { class: "muted small" }, t("quickAddDesc")),
    h("label", { class: "field" }, h("span", {}, t("quickName")), name),
    h("label", { class: "field" }, h("span", {}, t("quickKcal", { unit: u.energy })), kcal),
    h("div", { class: "field-row three" }, p.field, c.field, f.field),
    segmented<MealType>(MEALS.map((m) => ({ value: m, label: m === "snack" ? t("snack") : mealLabel(m) })), chosen, (v) => (chosen = v), t("meal")),
    h(
      "div",
      { class: "sheet-actions" },
      h("button", { class: "btn ghost", onclick: () => mini.close() }, t("cancel")),
      h(
        "button",
        {
          class: "btn primary",
          onclick: () => {
            const shown = Number(kcal.value);
            if (!(shown > 0)) return toast(t("quickNeedKcal"));
            const kc = u.energy === "kJ" ? shown / 4.184 : shown;
            const g = (i: HTMLInputElement) => Math.max(0, Number(i.value) || 0);
            const title = name.value.trim() || t("quickDefault");
            logNew({ name: title, meal: chosen, items: [{ name: title, portion: t("oneServing"), calories: kc, protein_g: g(p.input), carbs_g: g(c.input), fat_g: g(f.input), fiber_g: 0, sugar_g: 0 }], source: "quick" });
            mini.close();
          },
        },
        t("addToLog"),
      ),
    ),
  );
  pendingMeal = null;
  mini.showModal();
  setTimeout(() => kcal.focus(), 60);
}

/** Save a new meal, then celebrate goals and achievements. */
function logNew(e: { name: string; meal: MealType; items: FoodItem[]; thumb?: string; source: EntrySource }) {
  const tg = settings.targets;
  const before = sum(entriesFor(viewDate).flatMap((x) => x.items)).calories;
  const now = new Date();
  const when = viewDate === localDate() ? now : new Date(parseDate(viewDate).getTime() + 12 * 3600000);
  highlightId = addEntry({ date: viewDate, time: when.getTime(), meal: e.meal, name: e.name, thumb: e.thumb, items: e.items, source: e.source });
  const after = before + sum(e.items).calories;
  draftText = "";
  render();
  if (viewDate === localDate() && before < tg.calories * 0.92 && after >= tg.calories * 0.92 && after <= tg.calories * 1.1) {
    toast(t("calGoalReached"));
    confetti();
  } else toast(celebrate());
  checkBadges();
}

// ---------------- achievements ----------------
let badgeQueue: string[] = [];

function checkBadges(silent = false) {
  if (!featureOn("badges")) return;
  const earned = earnedBadges(settings);
  const seen = seenBadges();
  const fresh = [...earned].filter((id) => !seen.has(id));
  if (!fresh.length) return;
  markBadgesSeen(fresh);
  if (silent) return;
  badgeQueue.push(...fresh);
  if (!document.querySelector(".badge-pop")) showNextBadge();
}

function showNextBadge() {
  const id = badgeQueue.shift();
  const b = BADGES.find((x) => x.id === id);
  if (!b) return;
  const pop = h(
    "div",
    { class: "badge-pop", role: "dialog", "aria-modal": "true", "aria-label": t("badgeUnlocked") },
    h(
      "div",
      { class: "badge-card" },
      h("div", { class: "badge-rays", "aria-hidden": "true" }),
      h("div", { class: "badge-medal" }, b.emoji),
      h("p", { class: "badge-kicker" }, t("badgeUnlocked")),
      h("h2", {}, badgeName(b)),
      h("p", { class: "muted" }, badgeDesc(b)),
      h(
        "button",
        {
          class: "btn primary wide",
          onclick: () => {
            pop.classList.add("out");
            setTimeout(() => {
              pop.remove();
              if (badgeQueue.length) showNextBadge();
            }, 250);
          },
        },
        t("awesome"),
      ),
    ),
  );
  document.body.append(pop);
  setTimeout(() => confetti({ y: window.innerHeight * 0.35 }), 250);
}

function renderEntry(e: Entry) {
  const tot = sum(e.items);
  const u = U();
  const fav = isFavorite(e.name);
  const favBtn = h("button", { class: `btn small fav-btn${fav ? " on" : ""}` }, fav ? t("removeFavorite") : t("addFavorite"));
  favBtn.addEventListener("click", () => {
    const now = toggleFavorite({ name: e.name, thumb: e.thumb, items: e.items });
    toast(now ? t("favAdded") : t("favRemoved"));
    render();
    checkBadges();
  });
  const details = h(
    "div",
    { class: "entry-items" },
    ...e.items.map((i) => h("div", { class: "entry-item" }, h("span", {}, `${i.name} · ${i.portion}`), h("span", { class: "muted" }, fmtEnergy(i.calories, u, false)))),
    h(
      "div",
      { class: "entry-actions" },
      h("button", { class: "btn small", onclick: () => editEntry(e) }, `✏️ ${t("edit")}`),
      h("button", { class: "btn small", onclick: () => reLog(e) }, t("logAgain")),
      favBtn,
      h("button", { class: "btn danger small", onclick: () => { if (confirm(t("confirmDeleteEntry", { name: e.name }))) { deleteEntry(e.id); render(); } } }, t("delete")),
    ),
  );
  const row = h(
    "button",
    { class: "entry", "aria-expanded": "false" },
    e.thumb ? h("img", { class: "thumb", src: e.thumb, alt: "" }) : h("div", { class: "thumb placeholder" }, MEAL_EMOJI[e.meal]),
    h("div", { class: "entry-main" }, h("div", { class: "entry-name" }, fav ? `⭐ ${e.name}` : e.name), h("div", { class: "muted small" }, `P ${round(tot.protein_g)} · C ${round(tot.carbs_g)} · F ${round(tot.fat_g)} g`)),
    h("div", { class: "entry-kcal" }, fmtEnergy(tot.calories, u, false)),
  );
  row.addEventListener("click", () => {
    const open = row.getAttribute("aria-expanded") === "true";
    row.setAttribute("aria-expanded", String(!open));
    details.classList.toggle("open", !open);
  });
  return h("div", { class: "entry-wrap", "data-id": e.id }, row, details);
}

function reLog(e: Entry) {
  showReview({ meal_name: e.name, items: e.items.map((i) => ({ ...i })), confidence: "high", notes: "" }, { thumb: e.thumb, preview: e.thumb, noBadge: true, source: "repeat" });
}

function editEntry(e: Entry) {
  showReview({ meal_name: e.name, items: e.items.map((i) => ({ ...i })), confidence: "high", notes: "" }, { thumb: e.thumb, preview: e.thumb, noBadge: true, source: e.source ?? "repeat", entry: e });
}

// ======================= analysis + review =======================
const review = $("review") as HTMLDialogElement;

async function runAnalysis(input: { file?: File; text?: string }) {
  if (!settings.apiKey) {
    toast(t("needKey"), 5000);
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
    toast(t("badPhoto"));
    return;
  }
  const loader = analyzingView(preview);
  $("review-body").replaceChildren(loader.el);
  if (!review.open) review.showModal();
  try {
    const result = await analyzeMeal({ apiKey: settings.apiKey, image, text: input.text });
    loader.finish();
    await new Promise((r) => setTimeout(r, 380)); // let the progress bar complete
    showReview(result, { thumb, preview, source: input.file ? "photo" : "text" });
  } catch (err) {
    review.close();
    toast(err instanceof AnalysisError ? err.message : t("somethingWrong"), 8000);
  } finally {
    loader.stop();
  }
}

/** The "AI is looking at your food" animation: scanning beam over the photo (or orbiting food emojis) and changing steps. */
function analyzingView(preview?: string): { el: HTMLElement; stop: () => void; finish: () => void } {
  const steps: StringKey[] = ["loadFind", "loadPortion", "loadCount", "loadAlmost"];
  const label = h("p", { class: "an-step in" }, t(steps[0]));
  const FOODS = ["🍎", "🥑", "🍞", "🥦", "🍳", "🍌", "🥕", "🧀", "🍗", "🍓"];
  const pick = () => FOODS[(Math.random() * FOODS.length) | 0];
  const visual = preview
    ? h(
        "div",
        { class: "an-photo" },
        h("img", { src: preview, alt: "" }),
        h("div", { class: "an-grid", "aria-hidden": "true" }),
        h("div", { class: "an-beam", "aria-hidden": "true" }),
        h("div", { class: "an-corners", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")),
        h("div", { class: "an-sparkle s1" }, "✦"),
        h("div", { class: "an-sparkle s2" }, "✦"),
        h("div", { class: "an-sparkle s3" }, "✦"),
      )
    : h(
        "div",
        { class: "an-bowl", "aria-hidden": "true" },
        h("span", { class: "an-pulse" }),
        h("span", { class: "an-center" }, "🥗"),
        h("span", { class: "an-orbit o1" }, h("span", {}, pick())),
        h("span", { class: "an-orbit o2" }, h("span", {}, pick())),
        h("span", { class: "an-orbit o3" }, h("span", {}, pick())),
      );
  const dots = h("span", { class: "an-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  const fill = h("div", { class: "an-progress-fill" });
  let i = 0;
  const timer = window.setInterval(() => {
    if (i >= steps.length - 1) return;
    i++;
    label.classList.remove("in");
    void label.offsetWidth; // restart the fade-in
    label.textContent = t(steps[i]);
    label.classList.add("in");
  }, 1700);
  const el = h("div", { class: "loading analyzing", role: "status", "aria-live": "polite" }, visual, label, dots, h("div", { class: "an-progress" }, fill));
  return {
    el,
    stop: () => clearInterval(timer),
    finish: () => {
      fill.classList.add("done");
      label.textContent = "✓";
    },
  };
}

function showReview(result: Analysis, opt: { thumb?: string; preview?: string; noBadge?: boolean; source: EntrySource; entry?: Entry }) {
  const u = U();
  const items: FoodItem[] = result.items.map((i) => ({ ...i }));
  let servings = 1;
  let meal: MealType = opt.entry?.meal ?? pendingMeal ?? (viewDate === localDate() ? guessMeal() : "snack");
  pendingMeal = null;
  const nameInput = h("input", { class: "title-input", value: result.meal_name, "aria-label": t("mealName") });
  const star = h("button", { class: "icon-btn star-btn", "aria-label": t("addFavorite") }, isFavorite(result.meal_name) ? "★" : "☆");
  star.classList.toggle("on", isFavorite(result.meal_name));
  star.addEventListener("click", () => {
    const now = toggleFavorite({ name: nameInput.value.trim() || result.meal_name, thumb: opt.thumb, items: items.map(scaled) });
    star.textContent = now ? "★" : "☆";
    star.classList.toggle("on", now);
    replay(star, "pop");
    toast(now ? t("favAdded") : t("favRemoved"));
  });
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

  const addBtn = h("button", { class: "btn primary" }, opt.entry ? t("saveChanges") : t("addToLog"));
  let lastKcal = 0;

  function update() {
    servingsLabel.textContent = `${servings}×`;
    itemsBox.replaceChildren(
      ...items.map((item, idx) => {
        const kcal = h("input", { class: "kcal-input", type: "number", inputmode: "numeric", value: String(round(energyValue(item.calories, u))), "aria-label": t("energyFor", { unit: u.energy, item: item.name }) });
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
          { class: "review-item", style: `animation-delay:${idx * 70}ms` },
          h("div", { class: "ri-main" }, h("div", { class: "ri-name" }, item.name), h("div", { class: "muted small" }, `${item.portion} · P ${fmt1(item.protein_g)} · C ${fmt1(item.carbs_g)} · F ${fmt1(item.fat_g)}`)),
          kcal,
          h("button", { class: "icon-btn remove", "aria-label": t("removeItem", { item: item.name }), onclick: () => { items.splice(idx, 1); update(); } }, "×"),
        );
      }),
    );
    if (!items.length) itemsBox.append(h("p", { class: "muted" }, t("noItems")));
    const tot = sum(items.map(scaled));
    const num = h("span", {});
    countUp(num, lastKcal, tot.calories, (n) => fmtEnergy(n, u, false), 450);
    lastKcal = tot.calories;
    totalsBox.replaceChildren(
      h("div", { class: "tot-kcal" }, num, h("small", {}, ` ${u.energy}`)),
      h("div", { class: "tot-macros" }, t("totalsLine", { p: round(tot.protein_g), c: round(tot.carbs_g), f: round(tot.fat_g) })),
    );
    addBtn.disabled = !items.length;
  }

  addBtn.addEventListener("click", () => {
    const name = nameInput.value.trim() || result.meal_name;
    if (opt.entry) {
      updateEntry(opt.entry.id, { name, meal, items: items.map(scaled) });
      review.close();
      highlightId = opt.entry.id;
      render();
      toast(t("changesSaved"));
      return;
    }
    review.close();
    logNew({ name, meal, items: items.map(scaled), thumb: opt.thumb, source: opt.source });
  });

  const parts: (Node | null)[] = [
    opt.preview ? h("img", { class: "review-photo", src: opt.preview, alt: "" }) : null,
    h("div", { class: "title-row" }, nameInput, star),
    opt.noBadge ? null : h("span", { class: `badge ${result.confidence}` }, t(`conf_${result.confidence}` as StringKey)),
    result.notes ? h("p", { class: "notes" }, result.notes) : null,
    itemsBox,
    h(
      "div",
      { class: "servings" },
      h("span", {}, t("servings")),
      h(
        "div",
        { class: "stepper" },
        h("button", { class: "icon-btn", "aria-label": t("fewerServings"), onclick: () => { servings = Math.max(0.25, servings - 0.25); update(); } }, "−"),
        servingsLabel,
        h("button", { class: "icon-btn", "aria-label": t("moreServings"), onclick: () => { servings += 0.25; update(); } }, "+"),
      ),
    ),
    totalsBox,
    segmented<MealType>(MEALS.map((m) => ({ value: m, label: m === "snack" ? t("snack") : mealLabel(m) })), meal, (v) => (meal = v), t("meal")),
    h(
      "div",
      { class: "sheet-actions" },
      opt.entry
        ? h("button", { class: "btn danger", onclick: () => { if (confirm(t("confirmDeleteEntry", { name: opt.entry!.name }))) { deleteEntry(opt.entry!.id); review.close(); render(); } } }, t("delete"))
        : h("button", { class: "btn ghost", onclick: () => review.close() }, t("cancel")),
      addBtn,
    ),
  ];
  $("review-body").replaceChildren(...parts.filter((p): p is Node => p !== null));
  update();
  if (!review.open) review.showModal();
}

function celebrate(): string {
  const name = settings.profile?.name;
  const lines = celebrateLines(!!name);
  return lines[Math.floor(Math.random() * lines.length)].replace("{name}", name ?? "");
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
  const status = h("p", { class: "scan-status muted small" }, t("startingCamera"));
  const codeInput = h("input", { type: "text", inputmode: "numeric", placeholder: t("typeBarcode"), autocomplete: "off", "aria-label": t("barcodeNumber") });
  const form = h("form", { class: "text-form" }, codeInput, h("button", { type: "submit", class: "btn primary" }, t("lookUp")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (codeInput.value.trim()) handleCode(codeInput.value.trim());
  });
  const viewport = h("div", { class: "scan-viewport" }, video, h("div", { class: "scan-guide", "aria-hidden": "true" }));
  $("scanner-body").replaceChildren(
    h("h2", {}, t("scanBarcode")),
    viewport,
    status,
    form,
    h("div", { class: "sheet-actions" }, h("button", { class: "btn ghost", onclick: () => scanner.close() }, t("cancel"))),
  );
  scanner.showModal();

  async function handleCode(code: string) {
    stopScanner();
    viewport.classList.add("found");
    status.textContent = t("foundCode", { code });
    try {
      const found = await lookupBarcode(code);
      if (!found) {
        status.replaceChildren(
          t("notFound1"),
          h("button", { class: "link-btn", onclick: () => { scanner.close(); photoInput.click(); } }, t("notFound2")),
          t("notFound3"),
        );
        return;
      }
      scanner.close();
      showReview(found.analysis, { thumb: found.image, preview: found.image, noBadge: true, source: "barcode" });
    } catch (err) {
      status.textContent = err instanceof LookupError ? err.message : t("somethingWrong");
    }
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = t("noCameraApi");
    viewport.hidden = true;
    return;
  }
  startScanner(video, handleCode)
    .then((c) => {
      if (!scanner.open) return c.stop();
      scanControls = c;
      status.textContent = t("pointCamera");
    })
    .catch((err: unknown) => {
      viewport.hidden = true;
      const name = err instanceof Error ? err.name : "";
      status.textContent =
        name === "NotAllowedError"
          ? t("cameraBlocked")
          : t("cameraFailed");
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
          h("span", {}, parseDate(w.date).toLocaleDateString(locale(), { month: "short", day: "numeric", year: "numeric" })),
          h("span", {}, fmtWeight(w.kg, u)),
          h("button", { class: "icon-btn remove", "aria-label": t("deleteWeightFrom", { date: w.date }), onclick: () => { deleteWeight(w.date); syncWeight(); drawList(); render(); } }, "×"),
        ),
      ),
    );
  };
  drawList();
  $("mini-body").replaceChildren(
    h("h2", {}, t("logWeight")),
    h("div", { class: "field-row" }, h("label", { class: "field" }, h("span", {}, t("weightWithUnit", { unit: u.weight })), input), h("label", { class: "field" }, h("span", {}, t("date")), dateInput)),
    h("p", { class: "muted small" }, t("weightTip")),
    list,
    h(
      "div",
      { class: "sheet-actions" },
      h("button", { class: "btn ghost", onclick: () => mini.close() }, t("close")),
      h(
        "button",
        {
          class: "btn primary",
          onclick: () => {
            const kg = weightToKg(parseFloat(input.value), u);
            if (!(kg >= 10 && kg <= 300)) return toast(t("invalidWeight"));
            logWeight(dateInput.value || localDate(), kg);
            syncWeight();
            mini.close();
            render();
            toast(t("weightSaved"));
            checkBadges();
          },
        },
        t("save"),
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
    t("profile"),
    p
      ? h(
          "div",
          { class: "profile-summary" },
          h("div", { class: "avatar", "aria-hidden": "true" }, (p.name[0] || "?").toUpperCase()),
          h(
            "div",
            {},
            h("div", { class: "profile-name" }, p.name),
            h("div", { class: "muted small" }, `${p.age} · ${t(p.sex)} · ${fmtHeight(p.heightCm, u)} · ${fmtWeight(p.weightKg, u)}`),
            h("div", { class: "muted small" }, `${GOAL_EMOJI[p.goal]} ${goalLabel(p.goal)} · ${activitySummary(p)}`),
          ),
        )
      : h("p", { class: "muted" }, t("noProfile")),
    h("button", { class: "btn wide", onclick: editProfile }, p ? t("editProfile") : t("setupProfile")),
    featureOn("weight") ? h("button", { class: "btn wide ghost", onclick: openWeightDialog }, t("logWeightBtn")) : null,
  );

  // Targets
  const tgt = settings.targets;
  const targetFields: [keyof Targets, string, string][] = [
    ["calories", t("calories"), "kcal"],
    ["protein", t("protein"), "g"],
    ["carbs", t("carbs"), "g"],
    ["fat", t("fat"), "g"],
    ["fiber", t("fiber"), "g"],
    ["waterMl", t("water"), "ml"],
  ];
  const auto = settings.autoTargets && !!p;
  const plan = p ? makePlan(p) : null;
  const targetsCard = section(
    t("dailyTargets"),
    toggle(t("automatic"), auto, (v) => { settings.autoTargets = v; recomputeTargets(); rerender(); }, p ? t("automaticHint") : t("setupFirst")),
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
          h("summary", {}, t("howWorkedOut")),
          ...plan.notes.map((n) => h("p", { class: "plan-note" }, "⚠️ ", n)),
          ...plan.why.map((w) => h("div", { class: "why-item" }, h("strong", {}, w.title), h("p", {}, w.text))),
        )
      : null,
  );

  // Units
  const unitsCard = section(
    t("units"),
    unitRow(t("weight"), segmented([{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }], u.weight, (v) => { u.weight = v; rerender(); }, t("weight"))),
    unitRow(t("height"), segmented([{ value: "cm", label: "cm" }, { value: "ftin", label: "ft / in" }], u.height, (v) => { u.height = v; rerender(); }, t("height"))),
    unitRow(t("energy"), segmented([{ value: "kcal", label: "kcal" }, { value: "kJ", label: "kJ" }], u.energy, (v) => { u.energy = v; rerender(); }, t("energy"))),
    unitRow(t("water"), segmented([{ value: "ml", label: "ml / L" }, { value: "floz", label: "fl oz" }], u.water, (v) => { u.water = v; rerender(); }, t("water"))),
  );

  // Appearance
  const appearanceCard = section(
    t("appearance"),
    unitRow(t("theme"), segmented([{ value: "auto", label: t("themeAuto") }, { value: "light", label: t("themeLight") }, { value: "dark", label: t("themeDark") }], settings.theme, (v) => { settings.theme = v; applyTheme(); save(); }, t("theme"))),
    h(
      "div",
      { class: "unit-row" },
      h("span", {}, t("color")),
      h(
        "div",
        { class: "swatches", role: "radiogroup", "aria-label": t("color") },
        ...ACCENTS.map((a) => h("button", { class: `swatch sw-${a}`, role: "radio", "aria-checked": String(settings.accent === a), "aria-label": a, onclick: () => { settings.accent = a; applyTheme(); rerender(); } })),
      ),
    ),
  );

  // AI key
  const keyInput = h("input", { type: "password", value: settings.apiKey, placeholder: "AIza...", autocomplete: "off" });
  const aiCard = section(
    t("freeAi"),
    h("label", { class: "field" }, h("span", {}, settings.apiKey ? t("aiKeySaved") : t("aiKey")), keyInput),
    h("button", { class: "btn wide primary", onclick: () => { settings.apiKey = keyInput.value.trim(); save(); render(); toast(settings.apiKey ? t("keySaved") : t("keyRemoved")); } }, t("saveKey")),
    h("p", { class: "muted small" }, `${t("keyHelp1")} `, h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "aistudio.google.com/apikey"), ` ${t("keyHelp2")}`),
  );

  // Data
  const restoreInput = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  restoreInput.addEventListener("change", async () => {
    const f = restoreInput.files?.[0];
    restoreInput.value = "";
    if (!f) return;
    if (!confirm(t("confirmRestore"))) return;
    try {
      importBackup(await f.text(), settings.apiKey);
      location.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("restoreFailed"));
    }
  });
  const dataCard = section(
    t("yourData"),
    h("p", { class: "muted small" }, t("dataHelp")),
    h("button", { class: "btn wide", onclick: () => download(`foodchecker-backup-${localDate()}.json`, exportBackup(settings), "application/json") }, t("backup")),
    h("button", { class: "btn wide", onclick: () => restoreInput.click() }, t("restore")),
    h("button", { class: "btn wide", onclick: () => download(`foodchecker-${localDate()}.csv`, exportCsv(), "text/csv") }, t("exportCsv")),
    h(
      "button",
      {
        class: "btn wide danger",
        onclick: () => {
          if (!confirm(t("confirmDeleteAll"))) return;
          if (!confirm(t("confirmDeleteAll2"))) return;
          resetEverything();
          location.reload();
        },
      },
      t("deleteEverything"),
    ),
    restoreInput,
  );

  const about = h(
    "p",
    { class: "footer-note" },
    t("about"),
  );

  root.replaceChildren(
    h("div", { class: "subhead" }, h("button", { class: "back-btn", onclick: () => setTab("more") }, "‹ ", t("more"))),
    h("h1", { class: "page-title" }, t("settings")),
    languageCard(),
    profileCard,
    targetsCard,
    unitsCard,
    appearanceCard,
    h("button", { class: "card more-profile features-link", onclick: () => { openMorePage("features"); setTab("more"); } }, h("span", { class: "more-icon", style: "--tile:#e0a526", "aria-hidden": "true" }, "🧩"), h("span", { class: "more-text" }, h("span", { class: "more-title" }, t("features")), h("span", { class: "more-desc" }, t("featuresDesc"))), h("span", { class: "more-chev", "aria-hidden": "true" }, "›")),
    aiCard,
    dataCard,
    about,
  );
}

function languageCard() {
  return h(
    "section",
    { class: "card settings-card" },
    h("h3", {}, `🌍 ${t("language")}`),
    h(
      "div",
      { class: "lang-pick", role: "radiogroup", "aria-label": t("language") },
      ...LANGUAGES.map((l) =>
        h("button", { type: "button", class: "lang-chip", role: "radio", "aria-checked": String(getLanguage() === l.code), onclick: () => changeLanguage(l.code) }, `${l.flag} ${l.name}`),
      ),
    ),
  );
}

function changeLanguage(code: (typeof LANGUAGES)[number]["code"]) {
  settings.language = code;
  setLanguage(code);
  recomputeTargets();
  save();
  applyLanguage();
  render();
}

/** Text that lives in index.html (tab bar). */
function applyLanguage() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n as StringKey);
}

// ---------------- More tab ----------------
registerMorePage({
  id: "planner",
  emoji: "🗓️",
  color: "#8a63d2",
  title: "planner",
  desc: "plannerDesc",
  section: "tools",
  visible: () => featureOn("planner"),
  render: (root) =>
    renderPlanner(root, {
      settings: () => settings,
      goal: () => (settings.profile ? goalLabel(settings.profile.goal) : "eat balanced"),
      aiBadge,
      openSettings: () => setTab("settings"),
      log: (m) => {
        viewDate = localDate();
        pendingMeal = m.meal;
        showReview(
          { meal_name: m.title, items: [{ name: m.title, portion: m.portion, calories: m.calories, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, fiber_g: 0, sugar_g: 0 }], confidence: "medium", notes: "" },
          { noBadge: true, source: "plan" },
        );
      },
    }),
});
registerMorePage({
  id: "recipes",
  emoji: "📖",
  color: "#e8833a",
  title: "recipes",
  desc: "recipesDesc",
  section: "tools",
  visible: () => featureOn("recipes"),
  render: (root) => renderRecipes(root, { logText: (text) => runAnalysis({ text }), goChat: () => setTab("chat") }),
});
registerMorePage({ id: "shopping", emoji: "🛒", color: "#2f9e5e", title: "shopping", desc: "shoppingDesc", section: "tools", visible: () => featureOn("shopping"), render: (root) => renderShopping(root) });
registerMorePage({ id: "features", emoji: "🧩", color: "#e0a526", title: "features", desc: "featuresDesc", section: "app", render: (root) => renderFeatures(root) });

function renderFeatures(root: HTMLElement) {
  const groups: [string, FeatureId[]][] = [
    [t("today"), FEATURES.filter((f) => f.group === "today").map((f) => f.id)],
    [t("progress"), FEATURES.filter((f) => f.group === "progress").map((f) => f.id)],
    [t("moreTools"), FEATURES.filter((f) => f.group === "tools").map((f) => f.id)],
  ];
  const row = (id: FeatureId) => {
    const f = FEATURES.find((x) => x.id === id)!;
    const el = toggle(`${f.emoji}  ${t(f.label).replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "")}`, featureOn(id), (v) => {
      setFeature(settings, id, v);
      save();
      applyFeatureTabs();
      if (id === "water") renderFeatures(root);
    }, f.hint ? t(f.hint) : undefined);
    return el;
  };
  root.replaceChildren(
    h("h1", { class: "page-title" }, t("features")),
    h("p", { class: "muted" }, t("featuresIntro")),
    ...groups.map(([title, ids]) =>
      h(
        "section",
        { class: "card settings-card" },
        h("h3", {}, title),
        ...ids.map(row),
        ...(ids.includes("water") && featureOn("water")
          ? [
              unitRow(
                U().water === "ml" ? t("glassMl") : t("glassOz"),
                segmented(
                  [200, 250, 330, 500].map((ml) => ({ value: String(ml), label: U().water === "ml" ? `${ml}` : `${Math.round(ml / 29.5735)}` })),
                  String(settings.glassMl),
                  (v) => { settings.glassMl = Number(v); save(); },
                  U().water === "ml" ? t("glassMl") : t("glassOz"),
                ),
              ),
            ]
          : []),
      ),
    ),
    h("button", { class: "btn wide ghost", onclick: () => { settings.features = {}; settings.showWater = true; settings.showMotivation = true; save(); applyFeatureTabs(); renderFeatures(root); } }, t("featuresAllOn")),
  );
}
registerMorePage({ id: "settings", emoji: "⚙️", color: "#7d8590", title: "settings", desc: "settingsDesc", section: "app", open: () => setTab("settings") });
registerMorePage({
  id: "feedback",
  emoji: "💬",
  color: "#5b8def",
  title: "feedbackTitle",
  desc: "feedbackTileDesc",
  section: "app",
  render: (root) => root.replaceChildren(h("h1", { class: "page-title" }, t("feedbackTitle")), feedbackCard()),
});
registerMorePage({
  id: "share",
  emoji: "📲",
  color: "#2f9e5e",
  title: "shareApp",
  desc: "shareAppDesc",
  section: "app",
  open: async () => {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ title: "FoodChecker", text: t("shareAppText"), url });
      else {
        await navigator.clipboard.writeText(`${t("shareAppText")} ${url}`);
        toast(t("linkCopied"));
      }
    } catch {
      /* closed the share sheet */
    }
  },
});
registerMorePage({
  id: "about",
  emoji: "ℹ️",
  color: "#b06ad9",
  title: "aboutTitle",
  desc: "aboutDesc",
  section: "app",
  render: (root) =>
    root.replaceChildren(
      h("h1", { class: "page-title" }, t("aboutTitle")),
      h(
        "section",
        { class: "card about-card" },
        h("div", { class: "about-logo", "aria-hidden": "true" }, "🥗"),
        h("h2", {}, "FoodChecker"),
        h("p", { class: "muted" }, t("tagline")),
        h("p", {}, t("aboutPrivacy")),
        h("p", { class: "muted small" }, t("about")),
      ),
    ),
});

/** What the food chat knows about the user, so answers fit their day. */
function chatContext(): string {
  const p = settings.profile;
  const tg = settings.targets;
  const items = entriesFor(localDate()).flatMap((e) => e.items);
  const tot = sum(items);
  const parts = [
    p ? `Goal: ${goalLabel(p.goal)}. Age ${p.age}. ${p.sex}.` : "No profile.",
    `Daily targets: ${tg.calories} kcal, ${tg.protein} g protein. Eaten today: ${round(tot.calories)} kcal, ${round(tot.protein_g)} g protein.`,
    `Preferred units: ${settings.units.weight === "kg" ? "metric" : "US"}.`,
  ];
  return parts.join(" ");
}

// ---------------- feedback ----------------
function feedbackCard(): HTMLElement {
  let rating = 0;
  let kind: "fbBug" | "fbIdea" | "fbLove" | "fbOther" = "fbIdea";
  const stars = h("div", { class: "fb-stars", role: "radiogroup", "aria-label": t("feedbackRating") });
  const drawStars = () =>
    stars.replaceChildren(
      ...[1, 2, 3, 4, 5].map((n) =>
        h("button", { class: `fb-star${n <= rating ? " on" : ""}`, role: "radio", "aria-checked": String(n === rating), "aria-label": `${n}/5`, onclick: () => { rating = n; drawStars(); replay(stars.children[n - 1], "pop"); } }, n <= rating ? "★" : "☆"),
      ),
    );
  drawStars();
  const text = h("textarea", { class: "fb-text", rows: 4, placeholder: t("feedbackPh") });
  const sendBtn = h("button", { class: "btn wide primary" }, t("sendFeedback"));
  sendBtn.addEventListener("click", () => send());
  const send = async () => {
    const msg = text.value.trim();
    if (!msg) return toast(t("feedbackEmpty"));
    const body = [
      `FoodChecker – ${t(kind)}`,
      rating ? `${"★".repeat(rating)}${"☆".repeat(5 - rating)}` : "",
      "",
      msg,
      "",
      `— ${getLanguage()} · ${new Date().toISOString().slice(0, 10)} · ${navigator.userAgent.match(/iPhone OS [\d_]+|Android [\d.]+/)?.[0] ?? "web"}`,
    ]
      .filter((l, i) => l || i > 1)
      .join("\n");
    const done = () => {
      toast(t("feedbackThanks"));
      confetti({ count: 60 });
      text.value = "";
      rating = 0;
      drawStars();
    };
    // Straight to the app owner's email, when a Web3Forms key is set up.
    if (FEEDBACK_ACCESS_KEY) {
      sendBtn.disabled = true;
      sendBtn.textContent = "…";
      try {
        const res = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            access_key: FEEDBACK_ACCESS_KEY,
            subject: `FoodChecker feedback: ${t(kind).replace(/^\S+\s/, "")}${rating ? ` (${rating}/5)` : ""}`,
            from_name: settings.profile?.name ? `${settings.profile.name} (FoodChecker)` : "FoodChecker",
            message: body,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success !== false) return done();
      } catch {
        /* fall back to the share sheet below */
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = t("sendFeedback");
      }
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: "FoodChecker feedback", text: body });
      } else {
        await navigator.clipboard.writeText(body);
        toast(t("feedbackCopied"), 5000);
        return;
      }
      done();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // closed the share sheet
      try {
        await navigator.clipboard.writeText(body);
        toast(t("feedbackCopied"), 5000);
      } catch {
        toast(t("somethingWrong"));
      }
    }
  };
  return h(
    "section",
    { class: "card settings-card" },
    h("h3", {}, t("feedback")),
    h("p", { class: "muted small" }, t("feedbackDesc")),
    h("div", { class: "field" }, h("span", {}, t("feedbackRating")), stars),
    segmented(
      (["fbBug", "fbIdea", "fbLove", "fbOther"] as const).map((k) => ({ value: k, label: t(k) })),
      kind,
      (v) => (kind = v),
      t("feedback"),
    ),
    text,
    sendBtn,
  );
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
    onLanguage: (code) => {
      settings.language = code;
      save();
      applyLanguage();
      render();
    },
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
  toast(first ? t("allSet", { name: r.profile.name }) : t("profileUpdated"));
}

// ======================= wiring =======================
for (const b of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  b.addEventListener("click", () => {
    const next = b.dataset.tab as typeof tab;
    // Like iOS: tapping the tab you're already on takes you back to its start.
    if (next === "more" && (tab === "more" || tab === "settings")) {
      if (tab === "more" && !currentMorePage()) return void window.scrollTo({ top: 0, behavior: "smooth" });
      openMorePage(null);
    }
    setTab(next);
  });
}
applyFeatureTabs();

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
applyLanguage();
// People who used the app before achievements existed get their earned ones quietly.
try {
  if (localStorage.getItem("fc.badges.v1") === null) checkBadges(true);
} catch {
  /* ignore */
}
render();
hideSplash();

// Swipe left/right on Today to change day.
{
  let sx = 0;
  let sy = 0;
  let tracking = false;
  const today = $("view-today");
  today.addEventListener("touchstart", (e) => {
    const target = e.target as HTMLElement;
    tracking = !target.closest(".chips, input, .glasses");
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  today.addEventListener("touchend", (e) => {
    if (!tracking) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45) goDay(dx > 0 ? -1 : 1);
  }, { passive: true });
}
if (!settings.onboarded) setTimeout(editProfile, 300);

// Ask the browser to keep this app's data even when the phone is low on space.
navigator.storage?.persist?.().catch(() => {});

/** Fade out the start-up splash once the app has drawn (kept on screen briefly so the animation can play). */
function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const tag = document.getElementById("splash-tag");
  if (tag) tag.textContent = t("tagline");
  const wait = Math.max(0, 1300 - performance.now());
  setTimeout(() => {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 600);
  }, wait);
}
