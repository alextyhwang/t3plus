// A tiny, deterministic 8x8 Bayer ordered-dither texture. It is generated
// once as an SVG tile and reused by CSS, so there is no canvas, animation, or
// per-frame work in the page. Ordered Bayer dithering breaks up smooth
// gradients without introducing noise shimmer or a large image dependency.

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

const rects = BAYER_8.flatMap((row, y) =>
  row.map((threshold, x) => {
    const opacity = (0.025 + (threshold / 63) * 0.16).toFixed(3);
    return `<rect x="${x}" y="${y}" width="1" height="1" fill="#fff" opacity="${opacity}"/>`;
  }),
).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" shape-rendering="crispEdges">${rects}</svg>`;

export const BAYER_DITHER_DATA_URL = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

