import { locale, t } from "./i18n";
import { fmtEnergy, fmtNum, fmtWeight, energyValue, weightValue, goalEta } from "./nutrition";
import { addDays, allEntries, allWeights, localDate, parseDate, type Entry, type Goal, type Settings } from "./store";
import { h, s, segmented } from "./ui";

export type Range = "week" | "month" | "year";

interface DayTotal {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  meals: number;
}

function dayTotals(): Map<string, DayTotal> {
  const map = new Map<string, DayTotal>();
  for (const e of allEntries()) {
    const d = map.get(e.date) ?? { date: e.date, kcal: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
    d.meals++;
    for (const i of e.items) {
      d.kcal += i.calories;
      d.protein += i.protein_g;
      d.carbs += i.carbs_g;
      d.fat += i.fat_g;
    }
    map.set(e.date, d);
  }
  return map;
}

export function currentStreak(today = localDate()): number {
  const days = new Set(allEntries().map((e) => e.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

function bestStreak(): number {
  const days = [...new Set(allEntries().map((e) => e.date))].sort();
  let best = 0;
  let run = 0;
  let prev = "";
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

function onTarget(kcal: number, target: number, goal: Goal): boolean {
  const f = kcal / target;
  if (goal === "lose") return f >= 0.7 && f <= 1.05;
  if (goal === "gain" || goal === "muscle") return f >= 0.95 && f <= 1.2;
  return f >= 0.9 && f <= 1.1;
}

export function renderStats(root: HTMLElement, settings: Settings, range: Range, onRange: (r: Range) => void, onLogWeight: () => void) {
  const u = settings.units;
  const tg = settings.targets;
  const goal = settings.profile?.goal ?? "maintain";
  const today = localDate();
  const totals = dayTotals();

  // Build the series for the chosen range.
  type Bar = { label: string; tip: string; value: number; key: string };
  const bars: Bar[] = [];
  const rangeDays: string[] = [];
  if (range === "week" || range === "month") {
    const n = range === "week" ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) rangeDays.push(addDays(today, -i));
    rangeDays.forEach((d, idx) => {
      const date = parseDate(d);
      const v = totals.get(d)?.kcal ?? 0;
      const label =
        range === "week" ? date.toLocaleDateString(locale(), { weekday: "narrow" }) : idx % 5 === 4 || idx === n - 1 ? String(date.getDate()) : "";
      bars.push({
        key: d,
        label,
        value: v,
        tip: v
          ? t("dayTip", { date: date.toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" }), value: fmtEnergy(v, u) })
          : t("nothingLoggedTip", { date: date.toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" }) }),
      });
    });
  } else {
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const prefix = localDate(m).slice(0, 7);
      const days = [...totals.values()].filter((d) => d.date.startsWith(prefix));
      const avg = days.length ? days.reduce((a, d) => a + d.kcal, 0) / days.length : 0;
      bars.push({
        key: prefix,
        label: m.toLocaleDateString(locale(), { month: "narrow" }),
        value: avg,
        tip: days.length
          ? t("monthTip", { month: m.toLocaleDateString(locale(), { month: "long", year: "numeric" }), avg: fmtEnergy(avg, u), n: days.length })
          : t("nothingLoggedTip", { date: m.toLocaleDateString(locale(), { month: "long", year: "numeric" }) }),
      });
    }
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    for (let d = localDate(start); d <= today; d = addDays(d, 1)) rangeDays.push(d);
  }

  const logged = rangeDays.map((d) => totals.get(d)).filter((d): d is DayTotal => !!d);
  const avg = (f: (d: DayTotal) => number) => (logged.length ? logged.reduce((a, d) => a + f(d), 0) / logged.length : 0);
  const avgKcal = avg((d) => d.kcal);
  const hits = logged.filter((d) => onTarget(d.kcal, tg.calories, goal)).length;

  root.replaceChildren(
    h("h1", { class: "page-title" }, t("progress")),
    segmented<Range>(
      [
        { value: "week", label: t("week") },
        { value: "month", label: t("month") },
        { value: "year", label: t("year") },
      ],
      range,
      onRange,
      t("timeRange"),
    ),
    h(
      "div",
      { class: "stat-tiles" },
      statTile(t("avgPerDay"), logged.length ? fmtEnergy(avgKcal, u, false) : "–", u.energy),
      statTile(t("onTarget"), logged.length ? `${hits}/${logged.length}` : "–", t("days")),
      statTile(t("streak"), String(currentStreak()), t("best", { n: bestStreak() })),
      statTile(t("meals"), String(logged.reduce((a, d) => a + d.meals, 0)), t("logged")),
    ),
    h(
      "section",
      { class: "card" },
      h("div", { class: "card-head" }, h("h3", {}, range === "year" ? t("chartMonthly") : t("chartDaily")), h("span", { class: "legend-goal" }, t("goal"))),
      barChart(bars, energyValue(tg.calories, u), (v) => Math.round(energyValue(v, u))),
    ),
    h(
      "section",
      { class: "card" },
      h("h3", {}, t("avgMacros")),
      logged.length
        ? h(
            "div",
            { class: "macro-avgs" },
            macroRow(t("protein"), avg((d) => d.protein), tg.protein, "protein"),
            macroRow(t("carbs"), avg((d) => d.carbs), tg.carbs, "carbs"),
            macroRow(t("fat"), avg((d) => d.fat), tg.fat, "fat"),
          )
        : h("p", { class: "muted" }, t("logToSeeAvgs")),
    ),
    weightCard(settings, rangeDays[0], onLogWeight),
    topFoods(rangeDays[0]),
  );
}

function statTile(label: string, value: string, sub: string) {
  return h("div", { class: "stat-tile" }, h("div", { class: "muted small" }, label), h("div", { class: "stat-val" }, value), h("div", { class: "muted small" }, sub));
}

function macroRow(label: string, val: number, target: number, cls: string) {
  const pct = Math.min((val / (target || 1)) * 100, 100);
  return h(
    "div",
    { class: "macro", "data-macro": cls },
    h("div", { class: "macro-head" }, h("span", {}, label), h("span", { class: "macro-val" }, `${Math.round(val)} / ${target} g`)),
    h("div", { class: "bar" }, h("div", { class: "bar-fill", style: `width:${pct}%` })),
  );
}

function compact(v: number): string {
  return v >= 10000 ? `${Math.round(v / 1000)}k` : fmtNum(v);
}

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function roundedTop(x: number, y: number, w: number, hgt: number, r: number): string {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

function withTooltip(wrap: HTMLElement) {
  const tip = h("div", { class: "chart-tip", role: "status" });
  wrap.append(tip);
  return (text: string | null, x = 0, y = 0) => {
    if (!text) {
      tip.classList.remove("show");
      return;
    }
    tip.textContent = text;
    tip.classList.add("show");
    const w = wrap.clientWidth;
    tip.style.left = `${Math.max(4, Math.min(w - tip.offsetWidth - 4, x - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
  };
}

function barChart(bars: { label: string; tip: string; value: number }[], goal: number, conv: (v: number) => number): HTMLElement {
  const wrap = h("div", { class: "chart" });
  const W = Math.max(280, Math.min(560, (document.querySelector(".app")?.clientWidth ?? 360) - 64));
  const H = 180;
  const padL = 36;
  const padB = 22;
  const padT = 10;
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  const values = bars.map((b) => conv(b.value));
  const max = niceMax(Math.max(goal * 1.15, ...values));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const slot = plotW / bars.length;
  const bw = Math.max(3, slot - 2); // 2px gap between bars

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": t("caloriesChart") });
  for (const g of [0, max / 2, max]) {
    svg.append(s("line", { x1: padL, x2: W, y1: y(g), y2: y(g), class: "grid" }), s("text", { x: padL - 6, y: y(g) + 4, class: "axis", "text-anchor": "end" }, compact(g)));
  }
  const show = withTooltip(wrap);
  bars.forEach((b, i) => {
    const v = values[i];
    const x = padL + i * slot + (slot - bw) / 2;
    if (v > 0) svg.append(s("path", { d: roundedTop(x, y(v), bw, plotH + padT - y(v), Math.min(4, bw / 2)), class: "bar-mark" }));
    if (b.label) svg.append(s("text", { x: x + bw / 2, y: H - 6, class: "axis", "text-anchor": "middle" }, b.label));
    const hit = s("rect", { x: padL + i * slot, y: 0, width: slot, height: H, class: "hit" });
    const on = () => show(b.tip, padL + i * slot + slot / 2, y(Math.max(v, goal * 0.3)));
    hit.addEventListener("pointerenter", on);
    hit.addEventListener("click", on);
    hit.addEventListener("pointerleave", () => show(null));
    svg.append(hit);
  });
  svg.append(s("line", { x1: padL, x2: W, y1: y(goal), y2: y(goal), class: "goal-line" }));
  wrap.prepend(svg);
  return wrap;
}

function weightCard(settings: Settings, from: string, onLogWeight: () => void): HTMLElement {
  const u = settings.units;
  const p = settings.profile;
  const all = allWeights();
  const pts = all.filter((w) => w.date >= from);
  const latest = all[all.length - 1];
  const card = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h3", {}, t("weight")), h("button", { type: "button", class: "btn small", onclick: onLogWeight }, t("logWeightPlus"))),
  );
  if (!latest) {
    card.append(h("p", { class: "muted" }, t("weightEmpty")));
    return card;
  }
  const first = pts[0] ?? latest;
  const change = latest.kg - first.kg;
  card.append(
    h(
      "div",
      { class: "weight-summary" },
      h("div", {}, h("div", { class: "stat-val" }, fmtWeight(latest.kg, u)), h("div", { class: "muted small" }, t("latest"))),
      pts.length > 1 ? h("div", {}, h("div", { class: "stat-val" }, `${change > 0 ? "+" : change < 0 ? "−" : ""}${fmtWeight(Math.abs(change), u)}`), h("div", { class: "muted small" }, t("changeInRange"))) : null,
      p?.goalWeightKg ? h("div", {}, h("div", { class: "stat-val" }, fmtWeight(p.goalWeightKg, u)), h("div", { class: "muted small" }, t("goalLower"))) : null,
    ),
  );
  if (pts.length >= 2) card.append(lineChart(pts, p?.goalWeightKg, settings));
  const eta = p ? goalEta(p) : null;
  if (eta && p?.goalWeightKg) card.append(h("p", { class: "muted small" }, t("etaStats", { date: eta.toLocaleDateString(locale(), { month: "long", year: "numeric" }) })));
  return card;
}

function lineChart(pts: { date: string; kg: number }[], goalKg: number | undefined, settings: Settings): HTMLElement {
  const u = settings.units;
  const wrap = h("div", { class: "chart" });
  const W = Math.max(280, Math.min(560, (document.querySelector(".app")?.clientWidth ?? 360) - 64));
  const H = 160;
  const padL = 40;
  const padB = 20;
  const padT = 12;
  const vals = pts.map((p) => weightValue(p.kg, u));
  const extra = goalKg ? [weightValue(goalKg, u)] : [];
  let lo = Math.min(...vals, ...extra);
  let hi = Math.max(...vals, ...extra);
  const pad = Math.max(1, (hi - lo) * 0.15);
  lo = Math.floor(lo - pad);
  hi = Math.ceil(hi + pad);
  const t0 = parseDate(pts[0].date).getTime();
  const t1 = parseDate(pts[pts.length - 1].date).getTime();
  const x = (d: string) => padL + ((parseDate(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - padL - 8);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": t("weightChart") });
  for (const g of [lo, (lo + hi) / 2, hi]) {
    svg.append(s("line", { x1: padL, x2: W, y1: y(g), y2: y(g), class: "grid" }), s("text", { x: padL - 6, y: y(g) + 4, class: "axis", "text-anchor": "end" }, fmtNum(g)));
  }
  if (goalKg) svg.append(s("line", { x1: padL, x2: W, y1: y(weightValue(goalKg, u)), y2: y(weightValue(goalKg, u)), class: "goal-line" }));
  svg.append(s("polyline", { points: pts.map((p, i) => `${x(p.date)},${y(vals[i])}`).join(" "), class: "line-mark" }));
  const show = withTooltip(wrap);
  pts.forEach((p, i) => {
    const cx = x(p.date);
    const cy = y(vals[i]);
    if (pts.length <= 40 || i === pts.length - 1) svg.append(s("circle", { cx, cy, r: 4, class: "dot-mark" }));
    const hit = s("circle", { cx, cy, r: 14, class: "hit" });
    const on = () => show(`${parseDate(p.date).toLocaleDateString(locale(), { month: "short", day: "numeric" })}: ${fmtWeight(p.kg, u)}`, cx, cy);
    hit.addEventListener("pointerenter", on);
    hit.addEventListener("click", on);
    hit.addEventListener("pointerleave", () => show(null));
    svg.append(hit);
  });
  svg.append(
    s("text", { x: padL, y: H - 4, class: "axis" }, parseDate(pts[0].date).toLocaleDateString(locale(), { month: "short", day: "numeric" })),
    s("text", { x: W - 4, y: H - 4, class: "axis", "text-anchor": "end" }, parseDate(pts[pts.length - 1].date).toLocaleDateString(locale(), { month: "short", day: "numeric" })),
  );
  wrap.prepend(svg);
  return wrap;
}

function topFoods(from: string): HTMLElement {
  const counts = new Map<string, { name: string; n: number; kcal: number }>();
  for (const e of allEntries() as Entry[]) {
    if (e.date < from) continue;
    for (const i of e.items) {
      const k = i.name.trim().toLowerCase();
      const c = counts.get(k) ?? { name: i.name, n: 0, kcal: 0 };
      c.n++;
      c.kcal += i.calories;
      counts.set(k, c);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n || b.kcal - a.kcal).slice(0, 5);
  return h(
    "section",
    { class: "card" },
    h("h3", {}, t("mostEaten")),
    top.length
      ? h("ol", { class: "top-foods" }, ...top.map((f) => h("li", {}, h("span", {}, f.name), h("span", { class: "muted" }, `${f.n}×`))))
      : h("p", { class: "muted" }, t("nothingInRange")),
  );
}
