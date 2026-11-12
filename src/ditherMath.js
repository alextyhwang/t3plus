// Ordered (Bayer) dithering shared by the bot avatars and the background.
// Pure functions over typed arrays: no DOM, so they are easy to test.

/** n x n Bayer matrix (n a power of two), values 0..n*n-1. */
export function bayerMatrix(n) {
  let m = [[0]];
  while (m.length < n) {
    const size = m.length;
    const next = Array.from({ length: size * 2 }, () => new Array(size * 2));
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    }
    m = next;
  }
  return m;
}

const BAYER_N = 16;
const BAYER = bayerMatrix(BAYER_N);
/** Flat thresholds in (0, 1): 256 distinct levels, so ramps step smoothly. */
const THRESHOLDS = Float32Array.from(BAYER.flat(), (v) => (v + 0.5) / (BAYER_N * BAYER_N));

export function bayerThreshold(x, y) {
  return THRESHOLDS[(y & (BAYER_N - 1)) * BAYER_N + (x & (BAYER_N - 1))];
}

/** Quantizes v (0..1) to one of `levels` steps with an ordered-dither threshold. */
export function ditherLevel(v, levels, threshold) {
  const scaled = Math.max(0, Math.min(1, v)) * (levels - 1);
  const lo = Math.floor(scaled);
  return Math.min(levels - 1, scaled - lo > threshold ? lo + 1 : lo);
}

/** Glow geometry, as shares of the pane. The center sits slightly below the bottom edge. */
export const GLOW_SHAPE = Object.freeze({ coreRx: 0.288, coreRy: 0.216, haloRx: 0.45, haloRy: 0.396, drop: 0.05 });

const mixRgb = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));

/**
 * Glow strength (0..1) at pane position u, v (0..1, v = 0 at the top): a wide
 * core and halo centered at (cx, just below the bottom edge). Shared by every
 * dither style, so they all have the same shape.
 */
export function glowStrength(u, v, cx, intensity, cy = 1 + GLOW_SHAPE.drop) {
  const du = u - cx;
  const dv = v - cy;
  const d1 = Math.hypot(du / GLOW_SHAPE.coreRx, dv / GLOW_SHAPE.coreRy);
  const d2 = Math.hypot(du / GLOW_SHAPE.haloRx, dv / GLOW_SHAPE.haloRy);
  if (d2 >= 1 && d1 >= 1) return 0;
  const core = d1 < 1 ? (1 - d1) ** 1.2 : 0;
  const halo = d2 < 1 ? (1 - d2) ** 1.6 * 0.7 : 0;
  // Intensity widens the dense area.
  return Math.min(1, (1 - (1 - core) * (1 - halo)) * (0.6 + 0.8 * intensity));
}

/**
 * Interleaved gradient noise (Jimenez 2014): a cheap, deterministic,
 * blue-noise-like threshold. Same tones as Bayer, but scattered organically
 * instead of in Bayer's crosshatch grid.
 */
export function grainThreshold(x, y) {
  const f = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1);
  return f - Math.floor(f);
}

/** The three background styles. All are pixel art in the bot avatars' style. */
export const DITHER_STYLES = Object.freeze(["bayer", "grain", "spectrum"]);

const thresholdFor = (style) => (style === "grain" ? grainThreshold : bayerThreshold);

function rgbToHsl([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

/** Shifts hue by `deg` and sets lightness to `l` (0..1), keeping saturation (with a floor so greys still tint). */
function shade(rgb, deg, l) {
  const [h, s] = rgbToHsl(rgb);
  return hslToRgb([(h + deg + 360) % 360, Math.max(s, 0.35), l]);
}

/**
 * The glow's tones, darkest first. Each tone is a [rgb, alpha] pair; index 0
 * is empty (the page shows through). Tones are far apart in lightness, which
 * is what keeps the dither pattern visible instead of averaging into a smooth
 * gradient (the same reason the bot avatars read as pixel art).
 *  - bayer / grain: one hue, deep -> accent -> hot.
 *  - spectrum: the hue drifts across the ramp (a cooler deep tone, a warmer
 *    hot tone), so the glow is a streak of colored pixels.
 */
export function glowTones(rgb, style) {
  const [, , l] = rgbToHsl(rgb);
  const base = Math.min(0.62, Math.max(0.45, l));
  if (style === "spectrum") {
    return [null, [shade(rgb, -48, base * 0.34), 0.75], [shade(rgb, -22, base * 0.7), 0.9], [rgb, 1], [shade(rgb, 32, Math.min(0.86, base + 0.24)), 1]];
  }
  return [null, [shade(rgb, 0, base * 0.45), 0.7], [shade(rgb, 0, base * 0.75), 0.88], [rgb, 1], [shade(rgb, 0, Math.min(0.88, base + 0.25)), 1]];
}

/**
 * The bottom glow as pixel art: every cell is one of a few far-apart tones
 * (or empty), picked by an ordered threshold (Bayer or grain). The strength is
 * capped below 1 so even the core keeps mixing its top two tones: no flat,
 * smooth-looking fill anywhere.
 *
 * @param {{ width: number, height: number, cx: number, rgb: [number, number, number],
 *           intensity: number, style?: "bayer" | "grain" | "spectrum" }} o  cx and intensity are 0..1.
 */
export function glowPixelArt({ width, height, cx, rgb, intensity, style = "bayer", cy, sprite = null }) {
  const out = new Uint8ClampedArray(width * height * 4);
  if (intensity <= 0) return out;
  const tones = glowTones(rgb, style);
  const threshold = thresholdFor(style);
  const scale = 0.6 + 0.4 * intensity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const m = sprite
        ? glowStrength(0.5 + ((x + 0.5) / width - 0.5) * sprite.spanX, 0.5 + ((y + 0.5) / height - 0.5) * sprite.spanY, 0.5, intensity, 0.5)
        : glowStrength((x + 0.5) / width, (y + 0.5) / height, cx, intensity, cy);
      if (m <= 0) continue;
      const level = ditherLevel(Math.min(m, 0.9), tones.length, threshold(x, y));
      if (!level) continue;
      const [color, a] = tones[level];
      const i = (y * width + x) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = Math.round(255 * a * scale);
    }
  }
  return out;
}

/**
 * The glow on its own, centered in a sprite just big enough for its halo
 * (spanX/spanY = sprite size as a share of the pane). The renderer draws it
 * once and CSS moves it, so moving the glow (new thread <-> thread, composer
 * shifts) is an animated background-position, never a re-render.
 */
export function glowSpriteSpan() {
  return { spanX: GLOW_SHAPE.haloRx * 2, spanY: GLOW_SHAPE.haloRy * 2 };
}

/** Ordered dither of RGBA pixels in place: each channel snaps to `levels` steps. */
export function ditherRgbInPlace(data, width, height, levels = 8, style = "bayer") {
  const threshold = thresholdFor(style);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = threshold(x, y);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        data[i + c] = Math.round((ditherLevel(data[i + c] / 255, levels, t) / (levels - 1)) * 255);
      }
      data[i + 3] = 255;
    }
  }
  return data;
}
