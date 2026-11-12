import { BOT_COLORS, BOT_SHAPES, BOT_SKINS } from "./config.js";
import { bayerThreshold } from "./ditherMath.js";

// Bot avatar art: 24x24 pixel-art faces, built as SVG sprite sheets and cached
// per (color, shape, mood). The body is an ordered-dither gradient: every
// pixel is exactly one of the color's three stops, and a 16x16 Bayer
// threshold decides which (the same technique as the background). Two white
// pixel eyes sit at the shape's visual center and change with the bot's mood.
//
// Animated moods are horizontal sprite sheets; CSS steps through the frames
// (content.css, @keyframes t3plus-bot-sprite). Static moods are one frame.

export const BOT_GRID = 24;

/** Row status (bots.js parseRowStatus) -> face. "awake" is the neutral face used in Settings. */
export const MOOD_BY_STATUS = Object.freeze({
  idle: "idle",
  working: "working",
  waiting: "waiting",
  attention: "attention",
  failed: "failed",
  done: "done",
});

const BASE_LIGHT = [0.3, 0.26];

/**
 * Frames per mood. light: highlight position (0..1); eyes: glyph; dx/dy: eye
 * offset in cells; phase: shifts the dither threshold (makes the pixels
 * shimmer between frames); boost: brightens the ramp (a pulse).
 */
const MOODS = {
  awake: { duration: 0, frames: [{ eyes: "open" }] },
  idle: { duration: 0, frames: [{ eyes: "open", boost: -0.12 }] },
  waiting: { duration: 0, frames: [{ eyes: "lidded", dx: 1 }] },
  done: { duration: 0, frames: [{ eyes: "happy", boost: 0.08 }] },
  failed: { duration: 0, frames: [{ eyes: "x", boost: -0.22 }] },
  // Busy: the light orbits the body, the dither shimmers and the eyes look around (with a blink).
  working: {
    duration: 1.6,
    frames: [0, 1, 2, 3, 4, 5, 6, 7].map((f) => {
      const a = (f / 8) * Math.PI * 2 + Math.PI * 1.25;
      return {
        light: [0.5 + 0.24 * Math.cos(a), 0.5 + 0.24 * Math.sin(a)],
        eyes: f === 6 ? "closed" : "open",
        dx: [-1, -1, 0, 1, 1, 0, 0, 0][f],
        phase: f * 3,
      };
    }),
  },
  // Needs you: wide eyes that hop, a soft pulse, and a quick blink.
  attention: {
    duration: 1.4,
    frames: [0, 1, 2, 3, 4, 5, 6, 7].map((f) => ({
      eyes: f === 5 ? "closed" : "wide",
      dy: f === 1 || f === 2 ? -1 : 0,
      boost: f < 3 ? 0.14 : 0,
    })),
  },
};

/** Stop index (0 light, 1 mid, 2 dark) for pixel x,y of a frame. Exported for tests. */
export function ditherIndex(x, y, { light = BASE_LIGHT, phase = 0, boost = 0 } = {}) {
  const cx = (x + 0.5) / BOT_GRID - light[0];
  const cy = (y + 0.5) / BOT_GRID - light[1];
  const t = Math.max(0, Math.min(1, Math.hypot(cx, cy) / 0.95 - boost));
  const v = t * 2; // two bands: light->mid, mid->dark
  const band = Math.min(1, Math.floor(v));
  return v - band > bayerThreshold(x + phase, y + phase * 2) ? band + 1 : band;
}

// Eye boxes per shape on the 24-grid: [left x, right x, top y, width, height].
// Triangles and stars carry their visual center lower / tighter.
const EYES = {
  circle: [7, 14, 9, 3, 5],
  square: [7, 14, 9, 3, 5],
  hexagon: [7, 14, 9, 3, 5],
  diamond: [7, 14, 9, 3, 5],
  triangle: [8, 13, 13, 3, 5],
  star: [9, 13, 10, 2, 4],
  football: [11, 16, 12, 3, 5], // on the open lower-right side, clear of the diagonal laces
  basketball: [7, 15, 9, 3, 5], // one pixel wider apart: the vertical seam runs between them
};

/**
 * Fixed markings of the ball shapes (BOT_SKINS), drawn over the dither and
 * under the eyes: "x,y" -> layer (2 = dark stop, 3 = white). Exported for tests.
 */
export function skinMarks(shape) {
  const marks = new Map();
  const put = (x, y, layer) => {
    if (x >= 0 && x < BOT_GRID && y >= 0 && y < BOT_GRID) marks.set(`${x},${y}`, layer);
  };
  if (shape === "football") {
    // Laces on the diagonal ball: one stitch line along the long axis, set off
    // toward the upper-left side, with four cross stitches across it.
    for (let t = -4; t <= 4; t += 1) {
      put(8 + t, 8 - t, 3);
      if (t > -4) put(8 + t, 9 - t, 3); // thicken the diagonal so it reads at 32px
    }
    for (const t of [-3, -1, 1, 3]) {
      put(7 + t, 7 - t, 3);
      put(10 + t, 10 - t, 3);
    }
  } else if (shape === "basketball") {
    // Seams: a vertical seam between the eyes, an equator curved like a
    // smile below them, and the two curved side seams.
    for (let y = 0; y < BOT_GRID; y += 1) put(12, y, 2);
    for (let x = 0; x < BOT_GRID; x += 1) put(x, Math.round(13.5 + 3.5 * (1 - ((x - 12) / 12) ** 2)), 2);
    for (let y = 0; y < BOT_GRID; y += 1) {
      const bow = Math.round(0.5 + 2.5 * Math.sin((Math.PI * (y + 0.5)) / BOT_GRID));
      put(bow, y, 2);
      put(24 - bow, y, 2);
    }
  }
  return marks;
}

/** Cells of one eye, relative to its box, for a glyph. */
function eyeGlyph(glyph, w, h) {
  const cells = [];
  const pill = (top, rows, cutTop = true) => {
    for (let dy = 0; dy < rows; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const edgeRow = (cutTop && dy === 0) || dy === rows - 1;
        if (w >= 3 && edgeRow && (dx === 0 || dx === w - 1)) continue;
        cells.push([dx, top + dy]);
      }
    }
  };
  switch (glyph) {
    case "closed":
      for (let dx = 0; dx < w; dx += 1) cells.push([dx, h - 2]);
      break;
    case "lidded": // half-closed, looking sideways: flat top lid
      pill(2, h - 2, false);
      break;
    case "wide":
      pill(-1, h + 1);
      break;
    case "happy": // ^ ^
      cells.push([0, 2], [0, 3], [1, 1], [w - 1, 2], [w - 1, 3]);
      break;
    case "x":
      cells.push([0, 1], [2, 1], [1, 2], [0, 3], [2, 3]);
      break;
    default:
      pill(0, h);
  }
  return cells;
}

/** Cells of both eyes as "x,y" strings for a frame. */
export function eyeCells(shape, frame = { eyes: "open" }) {
  const [lx, rx, top, w, h] = EYES[shape] ?? EYES.circle;
  const dx = frame.dx ?? 0;
  const dy = frame.dy ?? 0;
  const cells = new Set();
  for (const x0 of [lx, rx]) {
    for (const [cx, cy] of eyeGlyph(frame.eyes ?? "open", w, h)) cells.add(`${x0 + cx + dx},${top + cy + dy}`);
  }
  return cells;
}

/** Cells touching an eye (4-neighbourhood) that are not part of it. */
export function eyeOutline(eyes) {
  const out = new Set();
  for (const cell of eyes) {
    const [x, y] = cell.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = `${x + dx},${y + dy}`;
      if (!eyes.has(next)) out.add(next);
    }
  }
  return out;
}

/** SVG path data with horizontal runs merged ("M x y h n v1 h-n z"), keeping sprites small. */
function runsPath(rows, offsetX) {
  let d = "";
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length; ) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j += 1;
      d += `M${xs[i] + offsetX} ${y}h${j - i + 1}v1h-${j - i + 1}z`;
      i = j + 1;
    }
  }
  return d;
}

const cache = new Map();

// In the browser the sprites are encoded as tiny PNGs (about 1-2 KB, against
// up to ~40 KB of per-pixel SVG paths for an 8-frame animation): the content
// script registers a canvas encoder here. Without one (Node tests) the SVG
// is used. The encoder gets one palette index per pixel and the palette.
let pixelEncoder = null;
export function setBotArtEncoder(encode) {
  pixelEncoder = typeof encode === "function" ? encode : null;
  cache.clear();
}

/** Whether `shape` brings its own colors (BOT_SKINS), so the bot's color is unused. */
export function botShapeHasOwnColors(shape) {
  return Object.hasOwn(BOT_SKINS, shape ?? "");
}

/**
 * The face for (color, shape, mood). Ball shapes (BOT_SKINS) ignore `color`.
 * @returns {{ url: string, frames: number, duration: number }} url is a CSS url("data:...").
 */
export function botArt(color, shape = "circle", mood = "awake") {
  const s = Object.hasOwn(BOT_SHAPES, shape) ? shape : "circle";
  const skin = Object.hasOwn(BOT_SKINS, s) ? BOT_SKINS[s] : null;
  // A ball shape has its own colors: the bot's color does not change it.
  const c = skin ? "" : Object.hasOwn(BOT_COLORS, color) ? color : "blue";
  const m = Object.hasOwn(MOODS, mood) ? mood : "awake";
  const key = `${c}:${s}:${m}`;
  if (cache.has(key)) return cache.get(key);
  const stops = skin ? skin.stops : BOT_COLORS[c].stops;
  const marks = skin ? skinMarks(s) : new Map();
  const { frames, duration } = MOODS[m];
  const layers = [new Map(), new Map(), new Map(), new Map()]; // per frame: 3 stops + eyes
  let d = ["", "", "", ""];
  const width = BOT_GRID * frames.length;
  const pixels = new Uint8Array(width * BOT_GRID);
  frames.forEach((frame, f) => {
    const eyes = eyeCells(s, frame);
    const lit = skin?.lift ? { ...frame, boost: (frame.boost ?? 0) + skin.lift } : frame;
    const outline = eyeOutline(eyes);
    for (const layer of layers) layer.clear();
    for (let y = 0; y < BOT_GRID; y += 1) {
      for (let x = 0; x < BOT_GRID; x += 1) {
        const cell = `${x},${y}`;
        // Eyes are white with a 1-pixel outline in the darkest stop, so they read on any part of the gradient.
        const index = eyes.has(cell) ? 3 : outline.has(cell) ? 2 : (marks.get(cell) ?? ditherIndex(x, y, lit));
        pixels[y * width + f * BOT_GRID + x] = index;
        const row = layers[index].get(y) ?? [];
        row.push(x);
        layers[index].set(y, row);
      }
    }
    d = d.map((path, i) => path + runsPath(layers[i], f * BOT_GRID));
  });
  const fills = [...stops, "#ffffff"];
  let encoded = null;
  try {
    encoded = pixelEncoder?.(pixels, width, BOT_GRID, fills) ?? null;
  } catch {
    encoded = null;
  }
  let url;
  if (encoded) url = `url("${encoded}")`;
  else {
    const body = d.map((path, i) => (path ? `<path fill="${fills[i]}" d="${path}"/>` : "")).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${BOT_GRID}" shape-rendering="crispEdges">${body}</svg>`;
    url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  const art = { url, frames: frames.length, duration };
  cache.set(key, art);
  return art;
}

/** The neutral (eyes open) face as a CSS url(): Settings swatches. */
export function botFillUrl(color, shape = "circle") {
  return botArt(color, shape, "awake").url;
}

/** clip-path value for `shape`. */
export function botClipPath(shape) {
  return BOT_SHAPES[shape] ?? BOT_SHAPES.circle;
}

/** Ring/edge color for an avatar: the color's mid stop (a ball shape's own mid stop). */
export function botEdgeColor(color, shape) {
  if (botShapeHasOwnColors(shape)) return BOT_SKINS[shape].stops[1];
  return (BOT_COLORS[color] ?? BOT_COLORS.blue).stops[1];
}

/** A stable default color for a bot that has none saved, so new bots differ. */
export function defaultBotColor(key) {
  const names = Object.keys(BOT_COLORS).filter((n) => n !== "gray");
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return names[hash % names.length];
}
