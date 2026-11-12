// Writes harness/out/moods.html: every bot mood, every frame, large, for visual review.
import { writeFile } from "node:fs/promises";
import { botArt, botClipPath } from "../src/botArt.js";
const moods = ["awake", "idle", "waiting", "done", "failed", "working", "attention"];
const rows = [];
const pairs = [["blue", "circle"], ["orange", "triangle"], ["purple", "hexagon"], ["green", "star"], ["blue", "football"], ["blue", "basketball"]];
// Real sizes: the row avatar (32px), the breadcrumb (1.25rem = 20px) and a Settings swatch.
const small = pairs.map(([color, shape]) => {
  const art = botArt(color, shape, "awake");
  return [32, 20].map((px) => `<i style='width:${px}px;height:${px}px;background-image:${art.url};background-size:100% 100%;clip-path:${botClipPath(shape)}'></i>`).join("");
}).join("");
rows.push(`<div><b>actual size 32 / 20</b>${small}</div>`);
for (const [color, shape] of pairs) {
  for (const mood of moods) {
    const art = botArt(color, shape, mood);
    const cells = Array.from({ length: art.frames }, (_, f) =>
      `<i style='background-image:${art.url};background-size:${art.frames * 100}% 100%;background-position:${art.frames > 1 ? (f / (art.frames - 1)) * 100 : 0}% 0;clip-path:${botClipPath(shape)}'></i>`).join("");
    rows.push(`<div><b>${color} ${shape} ${mood}</b>${cells}</div>`);
  }
}
await writeFile(new URL("./out/moods.html", import.meta.url), `<!doctype html><style>body{background:#111;color:#aaa;font:12px sans-serif;margin:8px}
div{display:flex;align-items:center;gap:6px;margin:2px 0}b{width:170px;font-weight:400}i{width:64px;height:64px;image-rendering:pixelated;background-repeat:no-repeat}</style>${rows.join("")}`);
