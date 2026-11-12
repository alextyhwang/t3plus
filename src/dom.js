/** Tiny element builder shared by the t3+ UI. `text` sets textContent; true/false toggle boolean attributes. */
export function createBuilder(doc) {
  return function h(tag, attrs = {}, children = []) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const child of [].concat(children)) if (child) el.append(child);
    return el;
  };
}

let uid = 0;
/** Unique ids for label/aria wiring. */
export const uniqueId = (name) => `t3plus-${name}-${(uid += 1)}`;

/** Sets textContent only when it differs, so updates do not churn the DOM. */
export function setText(el, value) {
  const next = value ?? "";
  if (el.textContent !== next) el.textContent = next;
}
