import { T3_SELECTORS, T3PLUS } from "./config.js";

/**
 * Writes the theme onto <html>. The backdrop and glass rules in content.css
 * key off these, so React remounting the composer or conversation needs no JS:
 * the new elements match the same selectors on their first paint.
 */
export function applyComposerTheme(doc, theme) {
  const root = doc.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  if (theme.mode) root.setAttribute(T3PLUS.modeAttr, theme.mode);
  else root.removeAttribute(T3PLUS.modeAttr);
  if (theme.glass) root.setAttribute(T3PLUS.glassAttr, "");
  else root.removeAttribute(T3PLUS.glassAttr);
}

/**
 * Fallback for a T3 build that drops data-chat-composer-surface but keeps the
 * body hook: tags the body's parent so content.css can still give that card
 * its glass. Idempotent and cheap; the DOM watcher calls it after mutations.
 *
 * @returns {{ surfaces: number, tagged: number, orphanEditors: number }}
 *   orphanEditors counts chat composer editors with neither hook above them,
 *   meaning the selectors in config.js need updating. Only editors in T3's chat
 *   composer area count: T3 reuses the same editor elsewhere (for example the
 *   font preview on Settings > Appearance), and those are not chat composers.
 */
export function syncComposerSurfaces(doc, enabled) {
  const tagged = doc.querySelectorAll(`[${T3PLUS.surfaceAttr}]`);
  if (!enabled) {
    for (const el of tagged) el.removeAttribute(T3PLUS.surfaceAttr);
    return { surfaces: 0, tagged: 0, orphanEditors: 0 };
  }

  const wanted = new Set();
  for (const body of doc.querySelectorAll(T3_SELECTORS.composerBody)) {
    if (body.closest(T3_SELECTORS.composerSurface)) continue;
    if (body.parentElement) wanted.add(body.parentElement);
  }
  for (const el of tagged) {
    if (!wanted.has(el)) el.removeAttribute(T3PLUS.surfaceAttr);
  }
  for (const el of wanted) {
    if (!el.hasAttribute(T3PLUS.surfaceAttr)) el.setAttribute(T3PLUS.surfaceAttr, "");
  }

  let orphanEditors = 0;
  for (const editor of doc.querySelectorAll(T3_SELECTORS.composerEditor)) {
    if (!editor.closest(T3_SELECTORS.chatComposerArea)) continue;
    if (!editor.closest(`${T3_SELECTORS.composerSurface}, ${T3_SELECTORS.composerBody}`)) orphanEditors += 1;
  }
  const surfaces = doc.querySelectorAll(T3_SELECTORS.composerSurface).length + wanted.size;
  return { surfaces, tagged: wanted.size, orphanEditors };
}

/**
 * Fallback for a T3 build without data-workspace-area="conversation": tags the
 * composer overlay's parent as the backdrop host. Cheaper than a CSS :has()
 * rule, which would be re-evaluated on every streaming mutation.
 * @returns {number} hosts tagged
 */
export function syncBackdropHosts(doc, enabled) {
  const tagged = doc.querySelectorAll(`[${T3PLUS.backdropHostAttr}]`);
  const wanted = new Set();
  if (enabled && !doc.querySelector(T3_SELECTORS.conversationArea)) {
    for (const overlay of doc.querySelectorAll(T3_SELECTORS.composerOverlay)) {
      if (overlay.parentElement) wanted.add(overlay.parentElement);
    }
  }
  for (const el of tagged) if (!wanted.has(el)) el.removeAttribute(T3PLUS.backdropHostAttr);
  for (const el of wanted) if (!el.hasAttribute(T3PLUS.backdropHostAttr)) el.setAttribute(T3PLUS.backdropHostAttr, "");
  return wanted.size;
}

/**
 * Keeps the backdrop's focal point aligned with the composer card rather than
 * the conversation pane. This matters when the details rail changes the pane
 * geometry: the glow should stay visually centered behind the composer.
 */
export function syncBackdropAnchor(doc) {
  const host = doc.querySelector(T3_SELECTORS.conversationArea) ?? doc.querySelector(`[${T3PLUS.backdropHostAttr}]`);
  if (!host || typeof host.getBoundingClientRect !== "function") return false;
  const hostRect = host.getBoundingClientRect();
  if (hostRect.width < 1) return false;
  const composer = findComposerCard(doc, hostRect);
  // None laid out yet (or collapsed mid-transition): keep the last good value.
  if (!composer) return false;
  const center = ((composer.left + composer.width / 2 - hostRect.left) / hostRect.width) * 100;
  const value = `${Math.max(0, Math.min(100, center)).toFixed(2)}%`;
  if (doc.documentElement.style.getPropertyValue("--t3plus-composer-x") !== value) {
    doc.documentElement.style.setProperty("--t3plus-composer-x", value);
  }
  return true;
}

/**
 * The rect of the composer card that sits over the painted pane. In T3 the
 * composer overlay is a SIBLING of the conversation area (ChatView.tsx), so it
 * is searched document-wide: the card (surface, else shell, else body) that is
 * laid out and overlaps the pane horizontally the most. A stale composer from
 * the previous thread, or one still mounting, never wins.
 */
function findComposerCard(doc, hostRect) {
  const minWidth = Math.min(240, hostRect.width * 0.25);
  for (const selector of [T3_SELECTORS.composerSurface, T3_SELECTORS.composerShell, T3_SELECTORS.composerBody]) {
    let best = null;
    let bestOverlap = 0;
    for (const el of doc.querySelectorAll(selector)) {
      if (!el.isConnected || typeof el.getBoundingClientRect !== "function") continue;
      const r = el.getBoundingClientRect();
      if (r.width < minWidth) continue;
      const overlap = Math.min(r.left + r.width, hostRect.left + hostRect.width) - Math.max(r.left, hostRect.left);
      if (overlap > bestOverlap) {
        best = r;
        bestOverlap = overlap;
      }
    }
    if (best) return best;
  }
  return null;
}

/** Composer cards content.css can make glass. Exported so tests can assert remounted nodes match it. */
export const PAINTED_SURFACE_SELECTOR = `${T3_SELECTORS.composerSurface}, [${T3PLUS.surfaceAttr}]`;

/** Elements content.css paints the backdrop layer on (mirrors content.css). */
export const BACKDROP_HOST_SELECTOR = `${T3_SELECTORS.conversationArea}, [${T3PLUS.backdropHostAttr}]`;
