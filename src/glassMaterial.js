import { T3_SELECTORS, T3PLUS } from "./config.js";

const PROPERTIES = ["fill", "filter", "outline", "highlight", "outer-shadow", "combined-shadow"];
const variable = name => `--t3plus-native-glass-${name}`;
export function clearGlassMaterial(doc) {
  for (const name of PROPERTIES) doc.documentElement.style.removeProperty(variable(name));
}

/** T3 moves its glass between shell, host and main for context rows/banners.
 * Read the visible paint layer and rim, including custom-theme surface colors.
 * Never compare a hidden pseudo-element just because it has matching tokens. */
export function syncGlassMaterial(doc, win) {
  if (!doc.documentElement.hasAttribute(T3PLUS.glassAttr)) { clearGlassMaterial(doc); return false; }
  const visible = (el, pseudo) => {
    if (!el || el.closest('[hidden], [aria-hidden="true"]') || el.getBoundingClientRect().width <= 0) return null;
    const s = win.getComputedStyle(el, pseudo);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0" || (pseudo && (!s.content || s.content === "none"))) return null;
    return s;
  };
  let material = null;
  for (const shell of doc.querySelectorAll(T3_SELECTORS.composerShell)) {
    const host = shell.querySelector(T3_SELECTORS.composerHost);
    const main = shell.querySelector(T3_SELECTORS.composerMainSurface);
    for (const [el, pseudo] of [[main, undefined], [host, "::before"], [shell, "::before"]]) {
      const paint = visible(el, pseudo);
      const filter = paint?.getPropertyValue("backdrop-filter");
      if (!paint || !filter || filter === "none") continue;
      const rim = visible(main, "::after") ?? visible(host, "::after");
      const outerShadow = win.getComputedStyle(el === main ? main : host ?? el).boxShadow;
      material = { fill: paint.backgroundColor, filter, outline: rim?.borderTopColor || paint.borderTopColor,
        highlight: rim?.boxShadow || "none", "outer-shadow": outerShadow || "none",
        "combined-shadow": [outerShadow, rim?.boxShadow].filter(value => value && value !== "none").join(", ") || "none" };
      break;
    }
    if (material) break;
  }
  if (!material) { clearGlassMaterial(doc); return false; }
  for (const [name, value] of Object.entries(material)) {
    if (doc.documentElement.style.getPropertyValue(variable(name)) !== value) doc.documentElement.style.setProperty(variable(name), value);
  }
  return true;
}
