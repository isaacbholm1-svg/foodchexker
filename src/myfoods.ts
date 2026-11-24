// "My foods": your own foods with nutrition from the label, logged in one tap without AI.
import { t } from "./i18n";
import { energyValue } from "./nutrition";
import { persisted, type Units } from "./store";
import { h, toast } from "./ui";

export interface MyFood {
  id: string;
  name: string;
  portion: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

const store = persisted<MyFood[]>("fc.myfoods.v1", []);
export const myFoods = () => store.get();

export function renderMyFoods(root: HTMLElement, deps: { units: () => Units; log: (f: MyFood) => void }) {
  let query = "";
  let adding = false;
  const draw = () => {
    const u = deps.units();
    const all = store.get();
    const list = query ? all.filter((f) => f.name.toLowerCase().includes(query.toLowerCase())) : all;
    const numIn = (label: string, unit: string) => {
      const i = h("input", { type: "number", inputmode: "decimal", min: 0, step: "any", placeholder: "0" });
      return { i, el: h("label", { class: "field" }, h("span", {}, `${label} (${unit})`), i) };
    };
    let form: HTMLElement | null = null;
    if (adding) {
      const name = h("input", { type: "text", placeholder: t("myFoodNamePh"), autocomplete: "off" });
      const portion = h("input", { type: "text", placeholder: t("myFoodPortionPh"), autocomplete: "off" });
      const kcal = numIn(t("energy"), u.energy);
      const p = numIn(t("protein"), "g");
      const c = numIn(t("carbs"), "g");
      const f = numIn(t("fat"), "g");
      const save = () => {
        const n = name.value.trim();
        const e = Number(kcal.i.value);
        if (!n) return name.focus();
        if (!(e >= 0) || kcal.i.value === "") return kcal.i.focus();
        store.set([
          { id: crypto.randomUUID(), name: n.slice(0, 60), portion: portion.value.trim().slice(0, 40) || t("onePortion"), calories: Math.round(e / energyValue(1, u)), protein_g: Number(p.i.value) || 0, carbs_g: Number(c.i.value) || 0, fat_g: Number(f.i.value) || 0 },
          ...store.get(),
        ]);
        toast(t("myFoodSaved"));
        adding = false;
        draw();
      };
      form = h(
        "section",
        { class: "card myfood-form" },
        h("h3", {}, t("newMyFood")),
        h("p", { class: "muted small" }, t("myFoodHint")),
        h("label", { class: "field" }, h("span", {}, t("foodName")), name),
        h("label", { class: "field" }, h("span", {}, t("portion")), portion),
        h("div", { class: "myfood-grid" }, kcal.el, p.el, c.el, f.el),
        h("div", { class: "recipe-actions" }, h("button", { class: "btn ghost", onclick: () => { adding = false; draw(); } }, t("cancel")), h("button", { class: "btn primary", onclick: save }, t("save"))),
      );
      setTimeout(() => name.focus(), 50);
    }
    const search = h("input", { type: "search", placeholder: t("searchFoods"), value: query, autocomplete: "off", class: "myfood-search" });
    search.addEventListener("input", () => {
      query = search.value;
      const pos = search.selectionStart;
      draw();
      const s2 = root.querySelector<HTMLInputElement>(".myfood-search");
      s2?.focus();
      if (pos != null) s2?.setSelectionRange(pos, pos);
    });
    root.replaceChildren(
      ...[
        h("h1", { class: "page-title" }, t("myFoods")),
        form ?? h("button", { class: "btn primary wide myfood-add", onclick: () => { adding = true; draw(); } }, t("newMyFood")),
        all.length > 5 ? search : null,
        all.length
          ? h(
              "div",
              { class: "recipe-list" },
              ...list.map((f) =>
                h(
                  "div",
                  { class: "card myfood-row" },
                  h("div", { class: "more-text" }, h("span", { class: "more-title" }, f.name), h("span", { class: "more-desc" }, `${f.portion} · ${Math.round(energyValue(f.calories, u))} ${u.energy} · ${t("protein")} ${f.protein_g} g`)),
                  h("button", { class: "btn small primary", onclick: () => deps.log(f) }, t("logThis")),
                  h("button", { class: "icon-btn remove", "aria-label": t("delete"), onclick: () => { if (confirm(t("confirmDeleteFood"))) { store.set(store.get().filter((x) => x.id !== f.id)); draw(); } } }, "×"),
                ),
              ),
            )
          : !adding
            ? h("p", { class: "card empty-note" }, t("noMyFoods"))
            : null,
      ].filter((n): n is HTMLElement => !!n),
    );
  };
  draw();
}
