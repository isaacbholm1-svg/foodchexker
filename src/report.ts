// Weekly report: the last 7 days in numbers, plus an optional AI-written summary.
import { AnalysisError, weeklyReport, type WeeklyReport } from "./ai";
import { allCheckins } from "./checkin";
import { allWorkouts } from "./exercise";
import { featureOn } from "./features";
import { t } from "./i18n";
import { fmtEnergy, fmtNum, fmtWater, fmtWeight } from "./nutrition";
import { addDays, allEntries, allWeights, localDate, persisted, waterFor, type Settings } from "./store";
import { h } from "./ui";

interface WeekStats {
  from: string;
  to: string;
  daysLogged: number;
  avgKcal: number;
  avgProtein: number;
  onTarget: number;
  proteinDays: number;
  avgWater: number;
  workouts: number;
  workoutMin: number;
  weightChange: number | null;
  avgMood: number | null;
  topFoods: string[];
}

export function weekStats(s: Settings, to = localDate()): WeekStats {
  const from = addDays(to, -6);
  const tg = s.targets;
  const entries = allEntries().filter((e) => e.date >= from && e.date <= to);
  const days = new Map<string, { kcal: number; protein: number }>();
  const foods = new Map<string, number>();
  for (const e of entries) {
    const d = days.get(e.date) ?? { kcal: 0, protein: 0 };
    for (const i of e.items) {
      d.kcal += i.calories;
      d.protein += i.protein_g;
    }
    days.set(e.date, d);
    foods.set(e.name, (foods.get(e.name) ?? 0) + 1);
  }
  const dayList = [...days.values()];
  const n = dayList.length;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const w = allWeights().filter((x) => x.date >= addDays(from, -3) && x.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const ws = allWorkouts().filter((x) => x.date >= from && x.date <= to);
  const moods = Object.entries(allCheckins()).filter(([d, c]) => d >= from && d <= to && c.mood).map(([, c]) => c.mood!);
  return {
    from,
    to,
    daysLogged: n,
    avgKcal: n ? dayList.reduce((a, d) => a + d.kcal, 0) / n : 0,
    avgProtein: n ? dayList.reduce((a, d) => a + d.protein, 0) / n : 0,
    onTarget: dayList.filter((d) => d.kcal >= tg.calories * 0.9 && d.kcal <= tg.calories * 1.1).length,
    proteinDays: dayList.filter((d) => d.protein >= tg.protein).length,
    avgWater: dates.reduce((a, d) => a + waterFor(d), 0) / 7,
    workouts: ws.length,
    workoutMin: ws.reduce((a, x) => a + x.minutes, 0),
    weightChange: w.length >= 2 ? w[w.length - 1].kg - w[0].kg : null,
    avgMood: moods.length ? moods.reduce((a, m) => a + m, 0) / moods.length : null,
    topFoods: [...foods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k),
  };
}

function summaryText(st: WeekStats, s: Settings, goal: string): string {
  const tg = s.targets;
  return [
    `Week ${st.from} to ${st.to}. Goal: ${goal}.${s.profile ? ` Age ${s.profile.age}.` : ""}`,
    `Daily targets: ${tg.calories} kcal, ${tg.protein} g protein, ${tg.waterMl} ml water.`,
    `Days with food logged: ${st.daysLogged} of 7.`,
    st.daysLogged ? `Average on logged days: ${Math.round(st.avgKcal)} kcal, ${Math.round(st.avgProtein)} g protein. Days within ±10% of the calorie target: ${st.onTarget}. Days reaching the protein target: ${st.proteinDays}.` : "",
    featureOn("water", s) ? `Average water: ${Math.round(st.avgWater)} ml per day.` : "",
    featureOn("exercise", s) ? `Workouts: ${st.workouts} (${st.workoutMin} min).` : "",
    st.weightChange !== null && featureOn("weight", s) && (s.profile?.age ?? 0) >= 18 ? `Weight change: ${st.weightChange >= 0 ? "+" : ""}${st.weightChange.toFixed(1)} kg.` : "",
    st.avgMood !== null ? `Average mood: ${st.avgMood.toFixed(1)} of 5.` : "",
    st.topFoods.length ? `Most logged: ${st.topFoods.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const cache = persisted<{ key: string; report: WeeklyReport } | null>("fc.report.v1", null);
let loading = false;
let error = "";

export function renderReport(root: HTMLElement, deps: { settings: () => Settings; goal: () => string; aiBadge: () => HTMLElement; openSettings: () => void }) {
  let firstDraw = true;
  const draw = () => {
    const s = deps.settings();
    const u = s.units;
    const st = weekStats(s);
    const key = `${st.to}:${st.daysLogged}:${Math.round(st.avgKcal)}`;
    const cached = cache.get();
    const report = cached && cached.key.startsWith(st.to) ? cached.report : null;
    const tile = (emoji: string, value: string, label: string) =>
      h("div", { class: `stat-tile rep-tile${firstDraw ? " rep-in" : ""}` }, h("div", { class: "rep-emoji", "aria-hidden": "true" }, emoji), h("div", { class: "rep-val" }, value), h("div", { class: "muted small" }, label));
    const tiles = [
      tile("📅", `${st.daysLogged}/7`, t("repDaysLogged")),
      tile("🔥", st.daysLogged ? fmtEnergy(st.avgKcal, u) : "–", t("repAvgKcal")),
      tile("🥩", st.daysLogged ? `${Math.round(st.avgProtein)} g` : "–", t("repAvgProtein")),
      tile("🎯", `${st.onTarget}`, t("repOnTarget")),
      featureOn("water", s) ? tile("💧", fmtWater(st.avgWater, u), t("repAvgWater")) : null,
      featureOn("exercise", s) ? tile("🏃", `${st.workouts}`, t("repWorkouts", { min: st.workoutMin })) : null,
      st.weightChange !== null && featureOn("weight", s) ? tile("⚖️", `${st.weightChange > 0 ? "+" : st.weightChange < 0 ? "−" : ""}${fmtWeight(Math.abs(st.weightChange), u)}`, t("repWeight")) : null,
      st.avgMood !== null && featureOn("checkin", s) ? tile(["😞", "😕", "😐", "🙂", "😄"][Math.round(st.avgMood) - 1] ?? "🙂", `${fmtNum(st.avgMood, 1)}/5`, t("ciMood")) : null,
    ].filter((n): n is HTMLDivElement => !!n);

    const generate = async () => {
      if (loading) return;
      loading = true;
      error = "";
      draw();
      try {
        const r = await weeklyReport(s.apiKey, summaryText(st, s, deps.goal()));
        cache.set({ key, report: r });
      } catch (e) {
        error = e instanceof AnalysisError ? e.message : t("somethingWrong");
      } finally {
        loading = false;
        if (root.isConnected) draw();
      }
    };

    let aiPart: HTMLElement;
    if (!s.apiKey) aiPart = h("section", { class: "card" }, h("p", { class: "muted" }, t("needKey")), h("button", { class: "btn wide", onclick: deps.openSettings }, t("settings")));
    else if (loading)
      aiPart = h("section", { class: "card rep-ai" }, h("div", { class: "plan-loading" }, h("div", { class: "plan-chef", "aria-hidden": "true" }, "📝"), h("p", {}, t("repWriting")), h("div", { class: "an-dots" }, h("i"), h("i"), h("i"))));
    else if (report)
      aiPart = h(
        "section",
        { class: "card rep-ai" },
        h("div", { class: "card-head" }, h("h3", {}, t("repCoach")), deps.aiBadge()),
        h("p", { class: "rep-headline" }, report.headline),
        report.wins.length ? h("div", {}, h("h4", { class: "rep-h" }, t("repWins")), h("ul", { class: "rep-list" }, ...report.wins.map((x) => h("li", {}, x)))) : null,
        report.focus.length ? h("div", {}, h("h4", { class: "rep-h" }, t("repFocus")), h("ul", { class: "rep-list" }, ...report.focus.map((x) => h("li", {}, x)))) : null,
        report.tip ? h("p", { class: "rep-tip" }, `💡 ${report.tip}`) : null,
        h("button", { class: "btn small ghost", onclick: generate }, t("repRegenerate")),
      );
    else
      aiPart = h(
        "section",
        { class: "card rep-ai" },
        h("p", { class: "muted small" }, st.daysLogged ? t("repAiIntro") : t("repNoData")),
        h("button", { class: "btn primary wide", disabled: !st.daysLogged, onclick: generate }, t("repWrite")),
        error ? h("p", { class: "plan-error" }, error) : null,
      );

    root.replaceChildren(
      h("h1", { class: "page-title" }, t("report")),
      h("p", { class: "muted small rep-range" }, t("repRange")),
      h("div", { class: "rep-grid" }, ...tiles),
      aiPart,
      h("p", { class: "footer-note" }, t("aiDisclaimer")),
    );
    firstDraw = false;
  };
  draw();
}
