import { createBuilder } from "./dom.js";

// One tooltip for the home cards, in T3's own tooltip language:
//   look   T3's chart tooltip (UsageProviderChart.tsx UsageChartTooltip):
//          surface-glass, rounded-xl, border-border/50, px-2.5 py-2, text-xs,
//          shadow-lg; a muted label, one row per series, a bordered Total row.
//   motion T3's tooltip popup (ui/tooltip.tsx): fades and scales from 98% in
//          and out, and its positioner glides between targets.
// It lives on <body> (so the scrolling card grid never clips it), is
// pointer-events: none and aria-hidden (the same numbers are in each card's
// aria-label), and is driven by pointer events on t3+'s own cards only.

export const TOOLTIP_ID = "t3plus-tip";
const GAP = 6;
const EDGE = 8;

export function createTooltip(doc) {
  const h = createBuilder(doc);
  const el = h("div", { id: TOOLTIP_ID, class: "t3plus-tip", "aria-hidden": "true", "data-t3plus-owned": "" });
  let open = false;

  function place(anchor) {
    const view = doc.defaultView;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let x = anchor.x - w / 2;
    x = Math.max(EDGE, Math.min(view.innerWidth - w - EDGE, x));
    let y = anchor.top - hgt - GAP;
    if (y < EDGE) y = anchor.bottom + GAP;
    el.style.setProperty("--tip-x", `${Math.round(x)}px`);
    el.style.setProperty("--tip-y", `${Math.round(y)}px`);
  }

  return {
    element: el,
    /**
     * @param {{ x: number, top: number, bottom: number }} anchor  viewport coordinates
     * @param {{ label: string, rows?: { name: string, value: string, color?: string }[], total?: { name: string, value: string } }} content
     */
    show(anchor, content) {
      if (!el.isConnected) doc.body.append(el);
      const rows = (content.rows ?? [])
        .filter((r) => r && r.name != null && r.value != null && r.name !== "null" && r.value !== "null")
        .map((r) =>
          h("div", { class: "t3plus-tip-row" }, [
            h("span", { class: "t3plus-tip-name" }, [r.color ? h("span", { class: "t3plus-tip-swatch", style: `background:${r.color}` }) : null, r.name]),
            h("span", { class: "t3plus-tip-value", text: r.value }),
          ]));
      const total = content.total && content.total.name != null && content.total.value != null && content.total.name !== "null" && content.total.value !== "null" ? content.total : null;
      const children = [h("div", { class: "t3plus-tip-label", text: content.label }), ...rows];
      if (total) children.push(h("div", { class: "t3plus-tip-row t3plus-tip-total" }, [h("span", { class: "t3plus-tip-name", text: total.name }), h("span", { class: "t3plus-tip-value", text: total.value })]));
      el.replaceChildren(...children);
      if (!open) {
        // First show: appear in place (no glide from the last spot), then animate in.
        el.setAttribute("data-instant", "");
        place(anchor);
        void el.offsetWidth;
        el.setAttribute("data-open", "");
        el.removeAttribute("data-instant");
        open = true;
      } else {
        place(anchor);
      }
    },
    hide() {
      if (!open) return;
      open = false;
      el.removeAttribute("data-open");
    },
    remove() {
      open = false;
      el.remove();
    },
  };
}
