import "./style.css";
import { analyzeMeal, AnalysisError, type Analysis, type FoodItem } from "./ai";
import { prepareImage } from "./image";
import {
  addEntry,
  deleteEntry,
  entriesFor,
  exportCsv,
  guessMeal,
  loadSettings,
  localDate,
  saveSettings,
  type Entry,
  type MealType,
} from "./store";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

let settings = loadSettings();
let viewDate = localDate();

// ---------- tiny DOM helper ----------
type Child = Node | string | number | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "class") {
      el.className = String(v);
    } else if (k in el && typeof v !== "string") {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const round = (n: number) => Math.round(n);
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

function sum(items: FoodItem[]) {
  return items.reduce(
    (t, i) => ({
      calories: t.calories + i.calories,
      protein_g: t.protein_g + i.protein_g,
      carbs_g: t.carbs_g + i.carbs_g,
      fat_g: t.fat_g + i.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

// ---------- toast ----------
let toastTimer = 0;
function toast(msg: string, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), ms);
}

// ---------- day navigation ----------
function shiftDay(delta: number) {
  const [y, m, d] = viewDate.split("-").map(Number);
  const next = new Date(y, m - 1, d + delta);
  const today = localDate();
  const nd = localDate(next);
  if (nd > today) return;
  viewDate = nd;
  render();
}

function dayLabel(date: string): string {
  const today = localDate();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (date === today) return "Today";
  if (date === localDate(y)) return "Yesterday";
  const [yy, mm, dd] = date.split("-").map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ---------- main render ----------
function render() {
  const entries = entriesFor(viewDate);
  const totals = sum(entries.flatMap((e) => e.items));

  $("day-label").textContent = dayLabel(viewDate);
  ($("next-day") as HTMLButtonElement).disabled = viewDate >= localDate();

  // ring
  const goal = settings.calorieGoal || 1;
  const left = round(settings.calorieGoal - totals.calories);
  const frac = Math.min(totals.calories / goal, 1);
  const C = 2 * Math.PI * 52;
  const ring = $("ring-fill") as unknown as SVGCircleElement;
  ring.style.strokeDasharray = `${C}`;
  ring.style.strokeDashoffset = `${C * (1 - frac)}`;
  ring.classList.toggle("over", left < 0);
  $("kcal-left").textContent = String(Math.abs(left));
  $("kcal-left-label").textContent = left < 0 ? "kcal over" : "kcal left";
  $("kcal-eaten").textContent = String(round(totals.calories));
  $("kcal-goal").textContent = String(settings.calorieGoal);

  const macros: [string, number, number][] = [
    ["protein", totals.protein_g, settings.proteinGoal],
    ["carbs", totals.carbs_g, settings.carbsGoal],
    ["fat", totals.fat_g, settings.fatGoal],
  ];
  for (const [key, val, g] of macros) {
    const row = document.querySelector<HTMLElement>(`.macro[data-macro="${key}"]`)!;
    row.querySelector(".macro-val")!.textContent = `${round(val)} / ${g} g`;
    (row.querySelector(".bar-fill") as HTMLElement).style.width = `${Math.min((val / (g || 1)) * 100, 100)}%`;
  }

  // log
  const log = $("log");
  log.replaceChildren();
  if (entries.length === 0) {
    log.append(
      h("div", { class: "empty" }, viewDate === localDate() ? "Nothing logged yet today. Snap your first meal above." : "Nothing logged this day."),
    );
    return;
  }
  for (const meal of MEALS) {
    const list = entries.filter((e) => e.meal === meal);
    if (!list.length) continue;
    const mealKcal = round(sum(list.flatMap((e) => e.items)).calories);
    log.append(
      h(
        "div",
        { class: "card meal-group" },
        h("div", { class: "meal-head" }, h("h3", {}, MEAL_LABEL[meal]), h("span", { class: "muted" }, `${mealKcal} kcal`)),
        ...list.map(renderEntry),
      ),
    );
  }
}

function renderEntry(e: Entry) {
  const t = sum(e.items);
  const details = h(
    "div",
    { class: "entry-items" },
    ...e.items.map((i) =>
      h("div", { class: "entry-item" }, h("span", {}, `${i.name} · ${i.portion}`), h("span", { class: "muted" }, `${round(i.calories)}`)),
    ),
    h(
      "button",
      {
        class: "btn danger small",
        onclick: () => {
          if (confirm(`Delete "${e.name}"?`)) {
            deleteEntry(e.id);
            render();
          }
        },
      },
      "Delete",
    ),
  );
  const row = h(
    "button",
    { class: "entry", "aria-expanded": "false" },
    e.thumb ? h("img", { class: "thumb", src: e.thumb, alt: "" }) : h("div", { class: "thumb placeholder" }, "🍽"),
    h(
      "div",
      { class: "entry-main" },
      h("div", { class: "entry-name" }, e.name),
      h("div", { class: "muted small" }, `P ${round(t.protein_g)} · C ${round(t.carbs_g)} · F ${round(t.fat_g)} g`),
    ),
    h("div", { class: "entry-kcal" }, String(round(t.calories))),
  );
  row.addEventListener("click", () => {
    const open = row.getAttribute("aria-expanded") === "true";
    row.setAttribute("aria-expanded", String(!open));
    details.classList.toggle("open", !open);
  });
  return h("div", { class: "entry-wrap" }, row, details);
}

// ---------- analyzing + review sheet ----------
const review = $("review") as HTMLDialogElement;

function needKey(): boolean {
  if (settings.apiKey) return false;
  toast("Add your Anthropic API key in Settings first.");
  openSettings();
  return true;
}

function showLoading(thumb?: string) {
  $("review-body").replaceChildren(
    h(
      "div",
      { class: "loading" },
      thumb ? h("img", { class: "review-photo", src: thumb, alt: "" }) : null,
      h("div", { class: "spinner", "aria-hidden": "true" }),
      h("p", {}, "Looking at your food…"),
    ),
  );
  if (!review.open) review.showModal();
}

async function runAnalysis(input: { file?: File; text?: string }) {
  if (needKey()) return;
  let image: { base64: string; mediaType: "image/jpeg" } | undefined;
  let thumb: string | undefined;
  let preview: string | undefined;
  try {
    if (input.file) {
      const prepared = await prepareImage(input.file);
      image = { base64: prepared.base64, mediaType: "image/jpeg" };
      thumb = prepared.thumb;
      preview = prepared.preview;
    }
  } catch {
    toast("Couldn't read that photo. Try a different one.");
    return;
  }
  showLoading(preview);
  try {
    const result = await analyzeMeal({ apiKey: settings.apiKey, image, text: input.text });
    showReview(result, thumb, preview);
  } catch (err) {
    review.close();
    toast(err instanceof AnalysisError ? err.message : "Something went wrong. Try again.", 6000);
  }
}

function showReview(result: Analysis, thumb?: string, preview?: string) {
  const items: FoodItem[] = result.items.map((i) => ({ ...i }));
  let servings = 1;
  let meal: MealType = viewDate === localDate() ? guessMeal() : "snack";
  const nameInput = h("input", { class: "title-input", value: result.meal_name, "aria-label": "Meal name" });
  const itemsBox = h("div", { class: "review-items" });
  const totalsBox = h("div", { class: "review-totals" });
  const servingsLabel = h("span", { class: "serv-val" }, "1×");

  function scaled(i: FoodItem): FoodItem {
    return {
      ...i,
      calories: i.calories * servings,
      protein_g: i.protein_g * servings,
      carbs_g: i.carbs_g * servings,
      fat_g: i.fat_g * servings,
      fiber_g: i.fiber_g * servings,
      sugar_g: i.sugar_g * servings,
    };
  }

  function update() {
    servingsLabel.textContent = `${servings}×`;
    itemsBox.replaceChildren(
      ...items.map((item, idx) => {
        const kcal = h("input", {
          class: "kcal-input",
          type: "number",
          inputmode: "numeric",
          value: String(round(item.calories)),
          "aria-label": `Calories for ${item.name}`,
        });
        kcal.addEventListener("change", () => {
          const v = Math.max(0, Number(kcal.value) || 0);
          const ratio = item.calories > 0 ? v / item.calories : 0;
          // Editing calories scales the item's macros by the same amount.
          items[idx] = {
            ...item,
            calories: v,
            protein_g: item.protein_g * ratio,
            carbs_g: item.carbs_g * ratio,
            fat_g: item.fat_g * ratio,
            fiber_g: item.fiber_g * ratio,
            sugar_g: item.sugar_g * ratio,
          };
          update();
        });
        return h(
          "div",
          { class: "review-item" },
          h(
            "div",
            { class: "ri-main" },
            h("div", { class: "ri-name" }, item.name),
            h("div", { class: "muted small" }, `${item.portion} · P ${fmt1(item.protein_g)} · C ${fmt1(item.carbs_g)} · F ${fmt1(item.fat_g)}`),
          ),
          kcal,
          h(
            "button",
            {
              class: "icon-btn remove",
              "aria-label": `Remove ${item.name}`,
              onclick: () => {
                items.splice(idx, 1);
                update();
              },
            },
            "×",
          ),
        );
      }),
    );
    if (!items.length) itemsBox.append(h("p", { class: "muted" }, "No food items. Cancel and try another photo or description."));
    const t = sum(items.map(scaled));
    totalsBox.replaceChildren(
      h("div", { class: "tot-kcal" }, `${round(t.calories)}`, h("small", {}, " kcal")),
      h("div", { class: "tot-macros" }, `Protein ${round(t.protein_g)} g · Carbs ${round(t.carbs_g)} g · Fat ${round(t.fat_g)} g`),
    );
    addBtn.disabled = !items.length;
  }

  const mealPicker = h(
    "div",
    { class: "seg", role: "radiogroup", "aria-label": "Meal" },
    ...MEALS.map((m) => {
      const b = h(
        "button",
        { class: "seg-btn", role: "radio", "aria-checked": String(m === meal) },
        MEAL_LABEL[m].replace("Snacks", "Snack"),
      );
      b.addEventListener("click", () => {
        meal = m;
        mealPicker.querySelectorAll(".seg-btn").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      });
      return b;
    }),
  );

  const addBtn = h(
    "button",
    {
      class: "btn primary",
      onclick: () => {
        const now = new Date();
        const [y, m, d] = viewDate.split("-").map(Number);
        const when = viewDate === localDate() ? now : new Date(y, m - 1, d, 12);
        addEntry({
          date: viewDate,
          time: when.getTime(),
          meal,
          name: nameInput.value.trim() || result.meal_name,
          thumb,
          items: items.map(scaled),
        });
        review.close();
        $<HTMLInputElement>("text-input").value = "";
        render();
        toast("Added to your log");
      },
    },
    "Add to log",
  );

  const parts: (Node | null)[] = [
    preview ? h("img", { class: "review-photo", src: preview, alt: "" }) : null,
    nameInput,
    h("span", { class: `badge ${result.confidence}` }, `${result.confidence} confidence`),
    result.notes ? h("p", { class: "notes" }, result.notes) : null,
    itemsBox,
    h(
      "div",
      { class: "servings" },
      h("span", {}, "Servings"),
      h("div", { class: "stepper" },
        h("button", { class: "icon-btn", "aria-label": "Fewer servings", onclick: () => { servings = Math.max(0.25, servings - 0.25); update(); } }, "−"),
        servingsLabel,
        h("button", { class: "icon-btn", "aria-label": "More servings", onclick: () => { servings += 0.25; update(); } }, "+"),
      ),
    ),
    totalsBox,
    mealPicker,
    h("div", { class: "sheet-actions" }, h("button", { class: "btn ghost", onclick: () => review.close() }, "Cancel"), addBtn),
  ];
  $("review-body").replaceChildren(...parts.filter((p): p is Node => p !== null));
  update();
  if (!review.open) review.showModal();
}

// ---------- settings ----------
const settingsDlg = $("settings") as HTMLDialogElement;
const num = (id: string) => $<HTMLInputElement>(id);

function openSettings() {
  num("set-key").value = settings.apiKey;
  num("set-kcal").value = String(settings.calorieGoal);
  num("set-protein").value = String(settings.proteinGoal);
  num("set-carbs").value = String(settings.carbsGoal);
  num("set-fat").value = String(settings.fatGoal);
  settingsDlg.showModal();
}

settingsDlg.addEventListener("close", () => {
  if (settingsDlg.returnValue !== "save") return;
  const n = (id: string, fallback: number) => {
    const v = Number(num(id).value);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
  };
  settings = {
    apiKey: num("set-key").value.trim(),
    calorieGoal: n("set-kcal", settings.calorieGoal),
    proteinGoal: n("set-protein", settings.proteinGoal),
    carbsGoal: n("set-carbs", settings.carbsGoal),
    fatGoal: n("set-fat", settings.fatGoal),
  };
  saveSettings(settings);
  render();
  toast("Settings saved");
});

$("export-csv").addEventListener("click", () => {
  const blob = new Blob([exportCsv()], { type: "text/csv" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `foodchexker-${localDate()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// close sheets when tapping the dim backdrop
for (const dlg of [review, settingsDlg]) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg && !dlg.querySelector(".loading")) dlg.close();
  });
}

// ---------- wiring ----------
$("open-settings").addEventListener("click", openSettings);
$("prev-day").addEventListener("click", () => shiftDay(-1));
$("next-day").addEventListener("click", () => shiftDay(1));
$("day-label").addEventListener("click", () => {
  viewDate = localDate();
  render();
});

const photoInput = $<HTMLInputElement>("photo-input");
photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  if (file) runAnalysis({ file, text: $<HTMLInputElement>("text-input").value });
});

$("text-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("text-input");
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  input.blur();
  runAnalysis({ text });
});

// Re-render when the app comes back to the foreground on a new day.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") render();
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

render();
if (!settings.apiKey) setTimeout(openSettings, 400);
