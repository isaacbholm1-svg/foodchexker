// Small DOM helpers shared by every screen.
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
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

const SVGNS = "http://www.w3.org/2000/svg";
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

let toastTimer = 0;
export function hideToast() {
  clearTimeout(toastTimer);
  $("toast").classList.remove("show");
}

export function toast(msg: string, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  // Show above any open dialog.
  const open = document.querySelector<HTMLDialogElement>("dialog[open]");
  (open ?? document.body).append(t);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), ms);
}

/** A segmented control. Returns the element; calls onChange with the picked value. */
export function segmented<T extends string>(options: { value: T; label: string }[], current: T, onChange: (v: T) => void, label = ""): HTMLDivElement {
  const wrap = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
  for (const o of options) {
    const b = h("button", { type: "button", class: "seg-btn", role: "radio", "aria-checked": String(o.value === current) }, o.label);
    b.addEventListener("click", () => {
      wrap.querySelectorAll(".seg-btn").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      onChange(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string): HTMLLabelElement {
  const input = h("input", { type: "checkbox", class: "switch-input", checked });
  input.addEventListener("change", () => onChange(input.checked));
  return h(
    "label",
    { class: "row-setting" },
    h("div", { class: "row-text" }, h("div", {}, label), hint ? h("div", { class: "muted small" }, hint) : null),
    input,
  );
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
