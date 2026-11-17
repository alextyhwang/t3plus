import { bayerMatrix } from "./ditherMath.js";

// A tiny, deterministic 8x8 Bayer ordered-dither texture. It is generated
// once as an SVG tile and reused by CSS, so there is no canvas, animation, or
// per-frame work in the page. Ordered Bayer dithering breaks up smooth
// gradients without introducing noise shimmer or a large image dependency.

// Indexed [x][y]: the tile is the transpose of the backdrop's pattern.
const BAYER_8 = bayerMatrix(8);

const rects = BAYER_8.flatMap((_, y) =>
  BAYER_8.map((column, x) => {
    const threshold = column[y];
    const opacity = (0.025 + (threshold / 63) * 0.16).toFixed(3);
    return `<rect x="${x}" y="${y}" width="1" height="1" fill="#fff" opacity="${opacity}"/>`;
  }),
).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" shape-rendering="crispEdges">${rects}</svg>`;

export const BAYER_DITHER_DATA_URL = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

