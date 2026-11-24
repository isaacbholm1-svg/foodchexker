// "Share my day": draws a summary card as an image and opens the share sheet.
import { t, locale } from "./i18n";
import { toast } from "./ui";

export interface DaySummary {
  date: string;
  name: string;
  eaten: number;
  target: number;
  energyUnit: string;
  fmt: (kcal: number) => string;
  protein: [number, number];
  carbs: [number, number];
  fat: [number, number];
  water: string | null;
  streak: number;
  score: number | null;
  meals: number;
}

export function drawDayCard(d: DaySummary): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#2f9e5e";
  const font = (w: number, s: number) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  // background
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#101418");
  bg.addColorStop(1, "#1d2530");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.18;
  g.fillStyle = accent;
  g.beginPath();
  g.arc(W - 60, 80, 330, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  // header
  g.fillStyle = "#fff";
  g.font = font(800, 54);
  g.fillText("🥗 FoodChecker", 80, 130);
  g.fillStyle = "rgba(255,255,255,0.65)";
  g.font = font(500, 36);
  const dateText = new Date(`${d.date}T12:00:00`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
  g.fillText(d.name ? `${d.name} · ${dateText}` : dateText, 80, 190);

  // ring
  const cx = W / 2;
  const cy = 520;
  const r = 230;
  g.lineCap = "round";
  g.lineWidth = 46;
  g.strokeStyle = "rgba(255,255,255,0.1)";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  const frac = Math.min(d.eaten / (d.target || 1), 1);
  g.strokeStyle = d.eaten > d.target * 1.1 ? "#e5484d" : accent;
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  g.stroke();
  g.textAlign = "center";
  g.fillStyle = "#fff";
  g.font = font(800, 112);
  g.fillText(d.fmt(d.eaten), cx, cy + 20);
  g.fillStyle = "rgba(255,255,255,0.65)";
  g.font = font(500, 38);
  g.fillText(`/ ${d.fmt(d.target)} ${d.energyUnit}`, cx, cy + 82);
  g.textAlign = "left";

  // macros
  const macros: [string, [number, number], string][] = [
    [t("protein"), d.protein, "#5b8def"],
    [t("carbs"), d.carbs, "#f2b134"],
    [t("fat"), d.fat, "#e5484d"],
  ];
  macros.forEach(([label, [v, goal], col], i) => {
    const y = 870 + i * 92;
    g.fillStyle = "#fff";
    g.font = font(600, 34);
    g.fillText(label, 80, y);
    g.textAlign = "right";
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillText(`${Math.round(v)} / ${goal} g`, W - 80, y);
    g.textAlign = "left";
    g.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(g, 80, y + 18, W - 160, 20, 10);
    g.fillStyle = col;
    roundRect(g, 80, y + 18, Math.max(20, (W - 160) * Math.min(v / (goal || 1), 1)), 20, 10);
  });

  // chips
  const chips = [
    d.streak > 0 ? `🔥 ${t("streak")}: ${d.streak}` : "",
    d.score !== null ? `🎯 ${t("dayScore")}: ${d.score}` : "",
    d.water ? `💧 ${d.water}` : "",
    `🍽️ ${d.meals}`,
  ].filter(Boolean);
  g.font = font(600, 32);
  let x = 80;
  let y = 1180;
  for (const chip of chips) {
    const w = g.measureText(chip).width + 48;
    if (x + w > W - 80) {
      x = 80;
      y += 76;
    }
    g.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(g, x, y - 44, w, 62, 31);
    g.fillStyle = "#fff";
    g.fillText(chip, x + 24, y);
    x += w + 16;
  }
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

export async function shareDay(d: DaySummary) {
  const canvas = drawDayCard(d);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return toast(t("somethingWrong"));
  const file = new File([blob], `foodchecker-${d.date}.png`, { type: "image/png" });
  const text = t("shareDayText", { kcal: `${d.fmt(d.eaten)} ${d.energyUnit}` });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
