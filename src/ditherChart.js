import { DITHER_CELL_CSS } from "./backdropRenderer.js";

// Dither-kit area fills for the widget charts and T3's own Usage chart. The
// SVG keeps the smooth path for hover math and as the no-canvas fallback; this
// paints the visible fill as square cells on the same pixel grid as the
// backdrop (whole device pixels, sized by --t3plus-dither-cell), with an
// ordered Bayer "fade": dense just under the line, dissolving toward the
// baseline over each area's own height.

const BAYER_8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

/** Fill density at a depth through an area (0 = just under its line, 1 = baseline). */
export function ditherDensity(depth) {
  const d = Math.max(0, Math.min(1, depth));
  return 0.02 + 0.98 * (1 - d) ** 1.8;
}

/** Whether the ordered-dither cell at (col, row) is lit at a density 0..1. */
export const ditherOn = (col, row, density) => (BAYER_8[row & 7][col & 7] + 0.5) / 64 < density;

/** The area's top edge (0..1 from the top) at x (0..1), or null outside the series. */
function edgeAt(points, x) {
  if (points.length < 2 || x < points[0][0] || x > points.at(-1)[0]) return null;
  let i = 1;
  while (i < points.length - 1 && points[i][0] < x) i += 1;
  const [x0, y0] = points[i - 1];
  const [x1, y1] = points[i];
  return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/**
 * Cell map for a plot: for each cell, the series index that owns it and
 * whether it is that series' edge (the stepped line). Pure, for tests.
 * @param {{ cols: number, rows: number, series: { points: [number, number][], dashed?: boolean }[] }} grid
 * @returns {{ fill: Int16Array, edge: Int16Array }} -1 where empty
 */
export function ditherCells({ cols, rows, series }) {
  const fill = new Int16Array(cols * rows).fill(-1);
  const edge = new Int16Array(cols * rows).fill(-1);
  series.forEach((s, si) => {
    let prevTop = null;
    for (let c = 0; c < cols; c += 1) {
      const y = edgeAt(s.points, (c + 0.5) / cols);
      if (y === null) {
        prevTop = null;
        continue;
      }
      const top = Math.max(0, Math.min(rows - 1, Math.floor(y * rows)));
      // A steep step fills the gap from the neighbouring column's edge, so the
      // line reads as one stepped stroke instead of loose dots.
      const from = prevTop === null ? top : Math.min(top, prevTop + (prevTop < top ? 1 : 0));
      const to = prevTop === null ? top : Math.max(top, prevTop - (prevTop > top ? 1 : 0));
      prevTop = top;
      const lineOn = !s.dashed || c % 3 !== 2;
      for (let r = from; r <= to && lineOn; r += 1) edge[r * cols + c] = si;
      // The series index shifts the Bayer phase so overlapping areas interleave.
      for (let r = top + 1; r < rows; r += 1) {
        if (ditherOn(c + si * 4, r, ditherDensity((r - top) / Math.max(1, rows - top)))) fill[r * cols + c] = si;
      }
    }
  });
  return { fill, edge };
}

/**
 * A canvas behind a plot's SVG. `series` points are fractions of the plot box.
 * The canvas's parent gets `data-t3plus-dithered` once it has painted, which
 * is what CSS uses to hide the SVG's own fills.
 * @param {Document} doc
 * @param {{ points: [number, number][], color: string, fillAlpha?: number, lineAlpha?: number, dashed?: boolean }[]} series
 */
export function createDitherCanvas(doc, series, { className = "t3plus-w-dither" } = {}) {
  const win = doc.defaultView;
  const canvas = doc.createElement("canvas");
  canvas.className = className;
  canvas.setAttribute("aria-hidden", "true");
  let key = "";

  function paint() {
    if (!canvas.isConnected || !win) return false;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return false;
    const dpr = win.devicePixelRatio || 1;
    const raw = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--t3plus-dither-cell"));
    const cellCss = Number.isFinite(raw) && raw > 0 ? raw : DITHER_CELL_CSS.medium;
    const cell = Math.max(2, Math.round(cellCss * dpr)); // whole device px, same rule as the backdrop
    const next = [width, height, dpr, cell].join();
    if (next === key) return true;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return false;
    key = next;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const cols = Math.ceil(canvas.width / cell);
    const rows = Math.ceil(canvas.height / cell);
    // Colors may be CSS variables or color-mix(): let the browser resolve them.
    const colors = series.map((s) => {
      canvas.style.color = s.color;
      return win.getComputedStyle(canvas).color;
    });
    canvas.style.color = "";
    const { fill, edge } = ditherCells({ cols, rows, series });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The grid hangs from the baseline so the solid bottom row is always whole.
    const y0 = canvas.height - rows * cell;
    for (let i = 0; i < fill.length; i += 1) {
      const si = edge[i] >= 0 ? edge[i] : fill[i];
      if (si < 0) continue;
      const s = series[si];
      ctx.globalAlpha = edge[i] >= 0 ? (s.lineAlpha ?? 1) : (s.fillAlpha ?? 0.7);
      ctx.fillStyle = colors[si];
      ctx.fillRect((i % cols) * cell, y0 + Math.floor(i / cols) * cell, cell, cell);
    }
    ctx.globalAlpha = 1;
    // Hide the SVG's fills only when there is something to show instead.
    canvas.parentElement?.toggleAttribute("data-t3plus-dithered", series.length > 0);
    return true;
  }

  const observer = win?.ResizeObserver ? new win.ResizeObserver(() => paint()) : null;
  observer?.observe(canvas);
  return {
    canvas,
    paint,
    /** New data for the same canvas (T3 re-rendered its chart). */
    setSeries(next) {
      series = next;
      key = "";
      return paint();
    },
    disconnect: () => observer?.disconnect(),
  };
}
