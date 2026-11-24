// The "More" tab: a menu of extra features, each opening its own page.
import { t, type StringKey } from "./i18n";
import { h } from "./ui";

export interface MorePage {
  id: string;
  emoji: string;
  color: string; // tile accent
  title: StringKey;
  desc: StringKey;
  section: "tools" | "app";
  visible?: () => boolean;
  render?: (root: HTMLElement, back: () => void) => void;
  open?: () => void; // for items that leave the More tab (e.g. Settings)
}

const pages: MorePage[] = [];
let current: string | null = null;

export function registerMorePage(p: MorePage) {
  if (!pages.some((x) => x.id === p.id)) pages.push(p);
}

export function openMorePage(id: string | null) {
  current = id;
}

export function currentMorePage(): string | null {
  return current;
}

export function renderMore(root: HTMLElement, header: () => HTMLElement | null, rerender: () => void) {
  const page = pages.find((p) => p.id === current && p.render);
  if (page?.render) {
    const back = () => {
      current = null;
      rerender();
    };
    const body = h("div", { class: "more-page" });
    root.replaceChildren(
      h("div", { class: "subhead" }, h("button", { class: "back-btn", onclick: back }, "‹ ", t("more"))),
      body,
    );
    page.render(body, back);
    return;
  }
  current = null;
  const tile = (p: MorePage, i: number) =>
    h(
      "button",
      {
        class: "more-tile",
        "data-page": p.id,
        style: `--tile:${p.color};animation-delay:${i * 35}ms`,
        onclick: () => {
          if (p.open) return p.open();
          current = p.id;
          rerender();
          window.scrollTo({ top: 0 });
        },
      },
      h("span", { class: "more-icon", "aria-hidden": "true" }, p.emoji),
      h("span", { class: "more-text" }, h("span", { class: "more-title" }, t(p.title)), h("span", { class: "more-desc" }, t(p.desc))),
      h("span", { class: "more-chev", "aria-hidden": "true" }, "›"),
    );
  const vis = pages.filter((p) => !p.visible || p.visible());
  const tools = vis.filter((p) => p.section === "tools");
  const app = vis.filter((p) => p.section === "app");
  root.replaceChildren(
    ...[
      h("h1", { class: "page-title" }, t("more")),
      header(),
      tools.length ? h("h2", { class: "more-section" }, t("moreTools")) : null,
      tools.length ? h("div", { class: "more-grid" }, ...tools.map(tile)) : null,
      h("h2", { class: "more-section" }, t("moreApp")),
      h("div", { class: "more-grid" }, ...app.map((p, i) => tile(p, i + tools.length))),
    ].filter((n): n is HTMLElement => !!n),
  );
}
