import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { createUsageDither, readUsageSeries, samplePath } from "../src/usageDither.js";

// The markup UsageProviderChart.tsx renders (t3code @ 5e6cc2b8), trimmed.
const chart = (claude, codex) => `
  <div class="relative h-56 flex-1" id="plot">
    <svg class="h-full w-full" viewBox="0 0 960 260" preserveAspectRatio="none" role="img" aria-label="Daily processed tokens by provider">
      <line x1="0" x2="960" y1="8" y2="8" stroke="currentColor"></line>
      <path d="${claude} L960,260 L0,260 Z" fill="#d97757" fill-opacity="0.12"></path>
      <path d="${codex} L960,260 L0,260 Z" fill="var(--contrast-foreground)" fill-opacity="0.12"></path>
      <path d="${claude}" fill="none" stroke="#d97757" stroke-width="2"></path>
      <path d="${codex}" fill="none" stroke="var(--contrast-foreground)" stroke-width="2"></path>
    </svg>
  </div>`;
const CLAUDE = "M0.00,130.00 C160.00,130.00 320.00,26.00 480.00,26.00 C640.00,26.00 800.00,130.00 960.00,130.00";
const CODEX = "M0.00,208.00 C320.00,208.00 640.00,182.00 960.00,182.00";

test("samplePath follows T3's monotone cubic path in viewBox fractions", () => {
  const points = samplePath(CLAUDE, 960, 260);
  assert.equal(points.length, 25, "the start plus 12 samples per segment");
  assert.deepEqual(points[0], [0, 0.5]);
  assert.deepEqual(points[12], [0.5, 0.1]);
  assert.deepEqual(points.at(-1), [1, 0.5]);
  assert.deepEqual(samplePath("M0,0 L10,10", 960, 260), [], "anything but M + C is ignored");
  assert.deepEqual(samplePath("", 960, 260), []);
});

test("readUsageSeries takes the line paths with their colors, in T3's order", () => {
  const { document } = new JSDOM(chart(CLAUDE, CODEX)).window;
  const series = readUsageSeries(document.querySelector("svg"));
  assert.deepEqual(series.map((s) => s.color), ["#d97757", "var(--contrast-foreground)"]);
  assert.equal(series[1].points.at(-1)[1], 0.7);
});

test("sync puts a canvas under T3's chart without touching the SVG, and clear removes it", () => {
  const { document } = new JSDOM(chart(CLAUDE, CODEX)).window;
  const plot = document.getElementById("plot");
  const before = plot.querySelector("svg").outerHTML;
  const usage = createUsageDither(document);
  usage.sync();
  usage.sync();
  assert.equal(plot.querySelectorAll("canvas.t3plus-usage-dither").length, 1);
  assert.equal(plot.firstElementChild.tagName, "CANVAS", "first, so it paints under the SVG");
  assert.ok(plot.hasAttribute("data-t3plus-usage-plot"));
  assert.equal(plot.querySelector("svg").outerHTML, before);
  usage.clear();
  assert.equal(plot.querySelector("canvas"), null);
  assert.ok(!plot.hasAttribute("data-t3plus-usage-plot"));
  assert.ok(!plot.hasAttribute("data-t3plus-dithered"));
});

test("a re-mounted chart gets a fresh canvas and the old one is dropped", () => {
  const { document } = new JSDOM(`<main>${chart(CLAUDE, CODEX)}</main>`).window;
  const usage = createUsageDither(document);
  usage.sync();
  document.querySelector("main").innerHTML = chart(CODEX, CLAUDE);
  usage.sync();
  assert.equal(document.querySelectorAll("canvas").length, 1);
  assert.equal(document.getElementById("plot").firstElementChild.tagName, "CANVAS");
});
