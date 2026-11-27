// Visual effects: confetti bursts and numbers that count up. All respect "Reduce Motion".

import { custom } from "./custom";

const reduced = () => !custom().motion || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

const COLORS = ["#2f8f5b", "#4cbf80", "#f2b134", "#e8615a", "#5b8def", "#b06ad9", "#ff9f43"];

/** A burst of confetti from a point (defaults to the top centre of the screen). */
export function confetti(opts: { x?: number; y?: number; count?: number } = {}) {
  if (reduced() || !custom().confetti) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  // Above open dialogs too.
  (document.querySelector("dialog[open]") ?? document.body).append(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const ox = opts.x ?? W / 2;
  const oy = opts.y ?? H * 0.3;
  const n = opts.count ?? 120;
  const parts = Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 6,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      round: Math.random() < 0.3,
    };
  });
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32; // gravity
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 2600);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Animate an element's number from `from` to `to`, formatting each step. */
export function countUp(el: HTMLElement, from: number, to: number, format: (n: number) => string, ms = 650) {
  if (reduced() || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = format(from);
  requestAnimationFrame(step);
}

/** Restart a CSS animation class on an element. */
export function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}
