import { T3_SELECTORS } from "./config.js";
import { createDitherCanvas } from "./ditherChart.js";

// T3's Usage page chart (UsageProviderChart.tsx) in the widgets' dither style.
// T3 renders it with React as one SVG: gridlines, an area per provider, then a
// line per provider. t3+ never edits that SVG. It reads the line paths, paints
// the dithered fill on a canvas placed under the SVG, and marks the plot so
// CSS hides T3's own area and line paths (gridlines and the hover rule stay).

/** Cubic segments sampled per segment: smooth enough at one cell per column. */
const SAMPLES = 12;

/**
 * Points (fractions of the viewBox) along an "M x,y C ... C ..." path, the only
 * shape T3's chart emits. Returns [] for anything else.
 * @returns {[number, number][]}
 */
export function samplePath(d, width, height) {
  const head = /^\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(d ?? "");
  if (!head || !width || !height) return [];
  let x0 = Number(head[1]);
  let y0 = Number(head[2]);
  const points = [[x0 / width, y0 / height]];
  for (const seg of d.slice(head[0].length).matchAll(/C\s*([^C]+)/g)) {
    const n = seg[1].trim().split(/[\s,]+/).map(Number);
    if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) return [];
    const [x1, y1, x2, y2, x3, y3] = n;
    for (let i = 1; i <= SAMPLES; i += 1) {
      const t = i / SAMPLES;
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      points.push([x / width, y / height]);
    }
    x0 = x3;
    y0 = y3;
  }
  return points.length > 1 ? points : [];
}

/** The series in one of T3's chart SVGs, heaviest first (T3's paint order). */
export function readUsageSeries(svg) {
  const [, , width, height] = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  return [...svg.querySelectorAll('path[fill="none"][stroke]')]
    .map((path) => ({ points: samplePath(path.getAttribute("d"), width, height), color: path.getAttribute("stroke"), fillAlpha: 0.75 }))
    .filter((s) => s.points.length > 1);
}

export function createUsageDither(doc) {
  const charts = new Map(); // T3's chart <svg> -> { dither, signature }

  function drop(svg, entry) {
    entry.dither.disconnect();
    const plot = entry.dither.canvas.parentElement;
    entry.dither.canvas.remove();
    plot?.removeAttribute("data-t3plus-dithered");
    plot?.removeAttribute("data-t3plus-usage-plot");
    charts.delete(svg);
  }

  return {
    /** Cheap when nothing changed: compares path data, repaints only on a change. */
    sync() {
      for (const [svg, entry] of charts) if (!svg.isConnected || entry.dither.canvas.parentElement !== svg.parentElement) drop(svg, entry);
      for (const svg of doc.querySelectorAll(T3_SELECTORS.usageChart)) {
        const plot = svg.parentElement;
        if (!plot) continue;
        const signature = [...svg.querySelectorAll('path[fill="none"][stroke]')].map((p) => `${p.getAttribute("stroke")}|${p.getAttribute("d")}`).join("\n");
        let entry = charts.get(svg);
        if (!entry) {
          entry = { dither: createDitherCanvas(doc, [], { className: "t3plus-usage-dither" }), signature: null };
          charts.set(svg, entry);
          plot.setAttribute("data-t3plus-usage-plot", "");
          // First child, so it paints under the SVG; React only appends after it.
          plot.prepend(entry.dither.canvas);
        }
        if (entry.signature !== signature) {
          entry.signature = signature;
          entry.dither.setSeries(readUsageSeries(svg));
        } else {
          entry.dither.paint(); // no-op unless the pixel size or layout changed
        }
      }
    },
    /** Puts T3's chart back exactly as it was (t3+ stopped). */
    clear() {
      for (const [svg, entry] of charts) drop(svg, entry);
    },
  };
}
