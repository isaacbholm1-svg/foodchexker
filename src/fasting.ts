// Fasting timer (12:12 / 14:10 / 16:8). Only offered to adults with a healthy BMI.
import { t } from "./i18n";
import { locale } from "./i18n";
import { persisted } from "./store";
import { h, toast } from "./ui";
import { confetti } from "./fx";

interface Fast {
  start: number;
  end: number;
  goalH: number;
}
interface FastState {
  start: number | null;
  goalH: number;
  history: Fast[];
}

const store = persisted<FastState>("fc.fast.v1", {
  start: null,
  goalH: 14,
  history: [],
});
export const completedFasts = () =>
  store.get().history.filter((f) => f.end - f.start >= f.goalH * 3600000)
    .length;
export const fastingNow = () => store.get().start !== null;

let timer: number | undefined;

const hm = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

export function renderFasting(root: HTMLElement) {
  clearInterval(timer);
  const draw = () => {
    const st = store.get();
    const now = Date.now();
    const running = st.start !== null;
    const elapsed = running ? now - st.start! : 0;
    const goalMs = st.goalH * 3600000;
    const frac = running ? Math.min(elapsed / goalMs, 1) : 0;
    const C = 2 * Math.PI * 52;
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ring.setAttribute("viewBox", "0 0 120 120");
    ring.setAttribute("class", "fast-ring");
    ring.innerHTML = `<circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-fill${frac >= 1 ? " done" : ""}" cx="60" cy="60" r="52" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - frac)}"/>`;
    const plans = h(
      "div",
      {
        class: "seg fast-plans",
        role: "radiogroup",
        "aria-label": t("fastPlan"),
      },
      ...[12, 14, 16].map((hh) =>
        h(
          "button",
          {
            class: `seg-btn${st.goalH === hh ? " on" : ""}`,
            role: "radio",
            "aria-checked": String(st.goalH === hh),
            disabled: running,
            onclick: () => {
              store.set({ ...st, goalH: hh });
              draw();
            },
          },
          `${hh}:${24 - hh}`,
        ),
      ),
    );
    const toggleFast = () => {
      if (!running) {
        store.set({ ...st, start: Date.now() });
        toast(t("fastStarted"));
      } else {
        const done = elapsed >= goalMs;
        store.set({
          ...st,
          start: null,
          history: [
            { start: st.start!, end: now, goalH: st.goalH },
            ...st.history,
          ].slice(0, 30),
        });
        if (done) {
          toast(t("fastDone", { h: hm(elapsed) }));
          confetti({ count: 80 });
        } else toast(t("fastEnded", { h: hm(elapsed) }));
      }
      draw();
    };
    const endsAt = running
      ? new Date(st.start! + goalMs).toLocaleTimeString(locale(), {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    root.replaceChildren(
      ...[
        h("h1", { class: "page-title" }, t("fasting")),
        h(
          "section",
          { class: "card fast-card" },
          plans,
          h(
            "div",
            { class: "fast-ring-wrap" },
            ring,
            h(
              "div",
              { class: "fast-center" },
              h(
                "div",
                { class: "muted small" },
                running
                  ? frac >= 1
                    ? t("fastGoalReached")
                    : t("fastElapsed")
                  : t("fastReady"),
              ),
              h(
                "div",
                { class: "fast-time" },
                running ? hm(elapsed) : `${st.goalH}:00`,
              ),
              running
                ? h(
                    "div",
                    { class: "muted small" },
                    frac >= 1 ? "🎉" : t("fastEndsAt", { time: endsAt }),
                  )
                : null,
            ),
          ),
          h(
            "button",
            {
              class: `btn wide ${running ? "" : "primary"}`,
              onclick: toggleFast,
            },
            running ? t("fastStop") : t("fastStart"),
          ),
        ),
        st.history.length
          ? h(
              "section",
              { class: "card" },
              h("h3", {}, t("fastHistory")),
              ...st.history
                .slice(0, 7)
                .map((f) =>
                  h(
                    "div",
                    { class: "ex-item" },
                    h(
                      "span",
                      { class: "ex-emoji", "aria-hidden": "true" },
                      f.end - f.start >= f.goalH * 3600000 ? "✅" : "⏹️",
                    ),
                    h(
                      "span",
                      { class: "ex-name" },
                      new Date(f.start).toLocaleDateString(locale(), {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      }),
                    ),
                    h(
                      "span",
                      { class: "ex-kcal" },
                      `${hm(f.end - f.start)} / ${f.goalH} h`,
                    ),
                  ),
                ),
            )
          : null,
        h("p", { class: "footer-note" }, t("fastSafety")),
      ].filter((n): n is HTMLElement => !!n),
    );
    clearInterval(timer);
    if (running)
      timer = window.setInterval(
        () => (root.isConnected ? draw() : clearInterval(timer)),
        30000,
      );
  };
  draw();
}
