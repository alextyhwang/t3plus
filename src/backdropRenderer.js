import { DITHER_STYLES, ditherRgbInPlace, GLOW_SHAPE, glowPixelArt, glowSpriteSpan } from "./ditherMath.js";

export { DITHER_STYLES };

// Real ordered dither for the background, in the same pixel-art style as the
// bot avatars. The glow (or image) is drawn once into a small canvas at
// "dither cell" resolution, quantized to a few far-apart tones, and shown as a
// crisp, pixelated CSS background image on the existing ::before layer. It is
// re-drawn only when something it depends on changes (pane size, composer
// position, color, intensity, style, image, DPR), after a short debounce,
// never per frame. Until a render is ready (or if one fails) the plain CSS
// gradient from content.css shows instead.
//
// Writes on <html>:
//   data-t3plus-dithered="<mode>"   the image below matches this backdrop mode
//   --t3plus-dither-image           url(blob:...) of the rendered PNG
//   --t3plus-dither-size            its CSS size, so cells land on device pixels
// and for the glow (a sprite, see placeGlow):
//   --t3plus-dither-w / -h          the sprite's CSS size
//   --t3plus-wide-image / -w / -h   the wider sprite shown on the new-thread page
//   --t3plus-glow-x / -y            the glow center in the pane (animated)
//   data-t3plus-glow-wide           present while the wide sprite is the one shown

/** How much wider the glow spreads on the new-thread page than in a thread. */
export const HERO_SPREAD = 1.15;

/**
 * Dither cell size in CSS px. "fine" matches one pixel of a 32 px bot avatar
 * (32 / 24 px). Sizes are in CSS px, not device px: on a 2x Retina display a
 * 2-device-pixel cell was only 1 CSS px and the dither vanished.
 */
export const DITHER_CELL_CSS = Object.freeze({ fine: 4 / 3, medium: 2, large: 3 });
/** Upper bound on rendered cells, so a huge window never costs more than a few ms. */
const MAX_CELLS = 1_200_000;

/** Cell size in CSS px (a whole number of device px) and canvas size for a pane. Exported for tests. */
export function ditherGrid(width, height, dpr, cellCss = DITHER_CELL_CSS.medium) {
  // Whole device pixels keep every cell the same size; never below 2 device px.
  let cellDevice = Math.max(2, Math.round(cellCss * dpr));
  while ((width * dpr * height * dpr) / (cellDevice * cellDevice) > MAX_CELLS) cellDevice += 1;
  const cell = cellDevice / dpr;
  return { cell, cols: Math.ceil(width / cell), rows: Math.ceil(height / cell) };
}

export function createBackdropRenderer({ win, doc, delayMs = 120 }) {
  const root = doc.documentElement;
  let lastKey = null;
  let scheduledKey = null;
  let timer = null;
  let url = null;
  let wideUrl = null;
  let generation = 0;
  const imageCache = new Map(); // src -> Promise<HTMLImageElement>

  // ---- Colors: resolve any CSS color (oklch, var(), color-mix) to sRGB bytes ----
  let probeCanvas = null;
  const rgbCache = new Map(); // css color -> [r, g, b]
  function toRgb(cssColor, fallback) {
    const key = `${cssColor}|${fallback}`;
    if (rgbCache.has(key)) return rgbCache.get(key);
    const rgb = paintRgb(cssColor, fallback);
    if (rgbCache.size > 32) rgbCache.clear();
    if (rgb) rgbCache.set(key, rgb);
    return rgb;
  }
  function paintRgb(cssColor, fallback) {
    try {
      probeCanvas ??= doc.createElement("canvas");
      probeCanvas.width = probeCanvas.height = 1;
      const ctx = probeCanvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = fallback;
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    } catch {
      return null;
    }
  }
  // Resolving a theme color needs a probe element and a style recalc, so the
  // answer is kept until the theme can have changed: a new class or theme
  // attribute on <html>, or after a few seconds (T3 themes set CSS variables).
  const colorCache = new Map(); // expr -> { stamp, at, value }
  const COLOR_TTL_MS = 3000;
  function computedColor(expr, el) {
    const stamp = `${root.className}|${root.getAttribute("data-theme") ?? ""}|${root.style.colorScheme}`;
    const at = win.performance?.now?.() ?? Date.now();
    const hit = colorCache.get(expr);
    if (hit && hit.stamp === stamp && at - hit.at < COLOR_TTL_MS) return hit.value;
    const probe = doc.createElement("span");
    probe.style.cssText = `position:absolute;width:0;height:0;overflow:hidden;color:${expr}`;
    (el ?? doc.body ?? root).append(probe);
    const value = win.getComputedStyle(probe).color;
    probe.remove();
    colorCache.set(expr, { stamp, at, value });
    return value;
  }

  // Glow center: registered custom properties on <html> (content.css
  // @property), so a change animates there and every pane, even one T3 just
  // remounted, reads the in-between values. The first placement is instant.
  let placed = false;
  const setVar = (name, value) => {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  };
  function placeGlow(x, y) {
    setVar("--t3plus-glow-x", x);
    setVar("--t3plus-glow-y", y);
    if (!placed) {
      placed = true;
      (win.requestAnimationFrame ?? ((f) => win.setTimeout(f, 16)))(() => root.setAttribute("data-t3plus-glow-ready", ""));
    }
  }

  function clear() {
    generation += 1;
    if (timer) win.clearTimeout(timer);
    timer = null;
    lastKey = null;
    scheduledKey = null;
    root.removeAttribute("data-t3plus-dithered");
    root.removeAttribute("data-t3plus-glow-wide");
    for (const name of ["--t3plus-dither-image", "--t3plus-dither-size", "--t3plus-dither-w", "--t3plus-dither-h", "--t3plus-wide-image", "--t3plus-wide-w", "--t3plus-wide-h", "--t3plus-glow-x", "--t3plus-glow-y"]) {
      root.style.removeProperty(name);
    }
    root.removeAttribute("data-t3plus-glow-ready");
    placed = false;
    if (url) win.URL.revokeObjectURL(url);
    if (wideUrl) win.URL.revokeObjectURL(wideUrl);
    url = null;
    wideUrl = null;
  }

  function loadImage(src) {
    if (!imageCache.has(src)) {
      const promise = (async () => {
        // Read through fetch into a data URL so the canvas is never tainted,
        // whatever origin the image came from (extension asset, blob, data URL).
        let dataSrc = src;
        if (!src.startsWith("data:")) {
          const blob = await (await win.fetch(src)).blob();
          dataSrc = await new Promise((resolve, reject) => {
            const reader = new win.FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        }
        const img = new win.Image();
        img.decoding = "async";
        img.src = dataSrc;
        await img.decode();
        return img;
      })();
      imageCache.clear(); // keep only the current image
      imageCache.set(src, promise);
      promise.catch(() => imageCache.delete(src));
    }
    return imageCache.get(src);
  }

  /** Draws `img` like object-fit: cover (centered on the composer), then the page-color scrim. */
  function drawCoverWithScrim(ctx, img, w, h, job) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * scale;
    const ih = img.naturalHeight * scale;
    const x = Math.min(0, Math.max(w - iw, job.cx * w - iw / 2));
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x, (h - ih) / 2, iw, ih);
    const [r, g, b] = job.background;
    const scrim = ctx.createLinearGradient(0, 0, 0, h);
    scrim.addColorStop(0, `rgba(${r},${g},${b},${job.scrimTop})`);
    scrim.addColorStop(1, `rgba(${r},${g},${b},${job.scrimBottom})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, w, h);
  }

  function glowBlob(job, cols, rows) {
    const canvas = doc.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    const pixels = glowPixelArt({ width: cols, height: rows, rgb: job.accent, intensity: job.intensity, style: job.style, sprite: job.sprite });
    ctx.putImageData(new win.ImageData(pixels, cols, rows), 0, 0);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function render(job, gen) {
    if (job.mode === "half-circle") {
      // Both sprites at once, so switching pages never waits on a render.
      const [near, wide] = await Promise.all([glowBlob(job, job.cols, job.rows), glowBlob(job, job.wideCols, job.wideRows)]);
      return near && wide ? { near, wide } : null;
    }
    const canvas = doc.createElement("canvas");
    canvas.width = job.cols;
    canvas.height = job.rows;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d canvas");
    const img = await loadImage(job.imageSrc);
    if (gen !== generation) return null;
    drawCoverWithScrim(ctx, img, job.cols, job.rows, job);
    const data = ctx.getImageData(0, 0, job.cols, job.rows);
    ditherRgbInPlace(data.data, job.cols, job.rows, 5, job.style);
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? { near: blob } : null;
  }

  const px = (v) => `${v.toFixed(3)}px`;
  function run(job, key) {
    timer = null;
    const gen = (generation += 1);
    render(job, gen)
      .then((blobs) => {
        if (!blobs || gen !== generation) return;
        const old = [url, wideUrl];
        url = win.URL.createObjectURL(blobs.near);
        wideUrl = blobs.wide ? win.URL.createObjectURL(blobs.wide) : null;
        root.style.setProperty("--t3plus-dither-image", `url("${url}")`);
        root.style.setProperty("--t3plus-dither-size", `${px(job.cols * job.cell)} ${px(job.rows * job.cell)}`);
        root.style.setProperty("--t3plus-dither-w", px(job.cols * job.cell));
        root.style.setProperty("--t3plus-dither-h", px(job.rows * job.cell));
        if (wideUrl) {
          root.style.setProperty("--t3plus-wide-image", `url("${wideUrl}")`);
          root.style.setProperty("--t3plus-wide-w", px(job.wideCols * job.cell));
          root.style.setProperty("--t3plus-wide-h", px(job.wideRows * job.cell));
        }
        root.setAttribute("data-t3plus-dithered", job.mode);
        lastKey = key;
        // Let the new images paint before dropping the old ones.
        win.setTimeout(() => old.forEach((u) => u && win.URL.revokeObjectURL(u)), 1000);
      })
      .catch(() => {
        if (gen !== generation) return;
        // Fall back to the CSS gradient rather than leave a stale image.
        root.removeAttribute("data-t3plus-dithered");
        lastKey = key;
      })
      .finally(() => {
        if (scheduledKey === key) scheduledKey = null;
      });
  }

  /**
   * @param {{ mode: "half-circle" | "image" | null, settings, imageSrc: string | null,
   *           host: Element | null, cx: number, cy?: number | null }} o  cx is 0..1 (composer
   *   center across the host); cy, when set, centers the glow vertically there (new-thread page).
   */
  function update({ mode, settings, imageSrc, host, cx, cy = null, wide = false }) {
    if (!mode || !host || typeof host.getBoundingClientRect !== "function") {
      if (lastKey || scheduledKey) clear();
      return;
    }
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // not laid out: keep what is shown
    const dpr = win.devicePixelRatio || 1;
    const g = settings.composerGradient;
    const cellCss = DITHER_CELL_CSS[g.ditherSize] ?? DITHER_CELL_CSS.medium;
    const style = DITHER_STYLES.includes(g.ditherStyle) ? g.ditherStyle : DITHER_STYLES[0];
    const i = g.intensity / 100;
    let job;
    if (mode === "half-circle") {
      // The glow is a sprite (just its halo's box) that CSS moves: where it sits
      // (composer x, bottom edge in a thread, pane center on the new-thread page)
      // is two animated lengths, not part of the render.
      // Two sprites with the same cells: the normal one and a wider one for
      // the new-thread page. Even cell counts keep each sprite's half size a
      // whole number of cells, so centering it never splits a pixel.
      const sprite = glowSpriteSpan();
      const even = (n) => n + (n % 2);
      const { cell, cols, rows } = ditherGrid(rect.width * sprite.spanX, rect.height * sprite.spanY, dpr, cellCss);
      const near = { cols: even(cols), rows: even(rows) };
      const wideCols = even(Math.round(near.cols * HERO_SPREAD));
      const wideRows = even(Math.round(near.rows * HERO_SPREAD));
      job = { mode, style, cell, ...near, wideCols, wideRows, sprite, paneW: Math.round(rect.width), paneH: Math.round(rect.height) };
      // Snap the center to the cell grid's device pixels.
      const snap = (v) => `${(Math.round(v * dpr) / dpr).toFixed(2)}px`;
      placeGlow(snap(cx * rect.width), snap((cy ?? 1 + GLOW_SHAPE.drop) * rect.height));
      if (root.hasAttribute("data-t3plus-glow-wide") !== wide) root.toggleAttribute("data-t3plus-glow-wide", wide);
    } else {
      const { cell, cols, rows } = ditherGrid(rect.width, rect.height, dpr, cellCss);
      job = { mode, style, cell, cols, rows, cx: Math.round(cx * 200) / 200 };
    }
    if (mode === "half-circle") {
      job.accent = toRgb(g.accent === "theme" ? computedColor("var(--primary, #6d7cff)", host) : g.accent, "#6d7cff");
      job.intensity = i;
    } else {
      if (!imageSrc) return;
      job.imageSrc = imageSrc;
      job.background = toRgb(computedColor("var(--background, #0a0a0a)", host), "#0a0a0a");
      Object.assign(job, { scrimTop: 1 - i * 0.55, scrimBottom: 1 - i * 0.9 });
    }
    if (!job.accent && !job.background) return;
    const key = JSON.stringify({ ...job, imageSrc: imageSrc ? `${imageSrc.length}:${imageSrc.slice(0, 64)}:${imageSrc.slice(-64)}` : null });
    if (key === lastKey || key === scheduledKey) return;
    scheduledKey = key;
    if (timer) win.clearTimeout(timer);
    // First paint immediately; later changes (resizes, slider drags) settle first.
    timer = win.setTimeout(() => run(job, key), lastKey ? delayMs : 0);
  }

  return { update, clear };
}
