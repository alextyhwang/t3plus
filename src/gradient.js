import { BAYER_DITHER_DATA_URL } from "./dither.js";
import { DITHER_CELL_CSS } from "./backdropRenderer.js";

// Pure mapping from settings to the CSS hooks that src/styles/content.css reads.
// No DOM access here, so the visual model is easy to test.
//
// v2 model: the gradient/image is a BACKGROUND layer painted behind the
// conversation and composer, and the composer card itself is translucent
// glass over it. Nothing is painted as the composer's own fill.

/**
 * @param {ReturnType<import("./settings.js").normalizeSettings>} settings
 * @param {string | null} imageUrl URL for image mode (blob:, chrome-extension:)
 * @returns {{ mode: "half-circle" | "image" | null, glass: boolean, vars: Record<string, string | null> }}
 *   `mode` goes on <html data-t3plus-backdrop>; null removes it.
 *   `glass` toggles <html data-t3plus-glass>.
 *   `vars` are custom properties on <html>; null removes the property.
 */
export function computeComposerTheme(settings, imageUrl) {
  const g = settings.composerGradient;
  const i = g.intensity;
  const s = settings.glass.strength;
  const vars = {
    "--t3plus-dither": BAYER_DITHER_DATA_URL,
    // One source of truth for every pixel surface: the backdrop renderer,
    // charts, heatmap cells, and the small profile/icon marks all read this
    // CSS length. Keeping it on <html> also lets a setting change repaint the
    // widgets without rebuilding their DOM.
    "--t3plus-dither-cell": `${DITHER_CELL_CSS[g.ditherSize] ?? DITHER_CELL_CSS.medium}px`,
    // --t3plus-composer-x is NOT set here: it is measured from the live layout
    // by syncBackdropAnchor (composer.js). Resetting it to 50% on every render
    // made the glow jump sideways and back on each thread switch.
    // Unset means "follow T3's --primary", resolved where the background is painted.
    "--t3plus-accent": g.accent === "theme" ? null : g.accent,
    // Half-circle: share of accent mixed into each stop.
    "--t3plus-core": `${Math.round(i * 0.7)}%`,
    "--t3plus-halo": `${Math.round(i * 0.45)}%`,
    "--t3plus-fade": `${Math.round(i * 0.18)}%`,
    // Image: share of the page background laid over the image. Heavier at the
    // top, where messages are read; lighter near the composer.
    "--t3plus-scrim-top": `${100 - Math.round(i * 0.55)}%`,
    "--t3plus-scrim-bottom": `${100 - Math.round(i * 0.9)}%`,
    "--t3plus-image": imageUrl ? `url("${cssEscapeUrl(imageUrl)}")` : null,
    // Glass: share of the card color kept in the composer surface, and blur radius.
    "--t3plus-glass-opacity": `${Math.round(88 - s * 0.6)}%`,
    "--t3plus-glass-blur": `${Math.round(8 + s * 0.16)}px`,
  };

  let mode = g.enabled ? g.mode : null;
  // Without a usable image, show nothing rather than an empty scrim.
  if (mode === "image" && !imageUrl) mode = null;
  return { mode, glass: settings.glass.enabled, vars };
}

/** Keeps a URL from breaking out of url("..."). */
export function cssEscapeUrl(url) {
  return String(url).replace(/["\\\n\r]/g, (ch) => `\\${ch === "\n" ? "a " : ch === "\r" ? "d " : ch}`);
}
