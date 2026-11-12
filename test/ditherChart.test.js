import test from "node:test";
import assert from "node:assert/strict";
import { ditherCells, ditherDensity, ditherOn } from "../src/ditherChart.js";

test("density fades from solid under the line to almost nothing at the baseline", () => {
  assert.equal(ditherDensity(0), 1);
  assert.ok(ditherDensity(1) < 0.05);
  for (let d = 0.1; d <= 1; d += 0.1) assert.ok(ditherDensity(d) < ditherDensity(d - 0.1));
});

test("lit cells per 8x8 block track the density (ordered dither)", () => {
  const lit = (density) => {
    let n = 0;
    for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) if (ditherOn(c, r, density)) n += 1;
    return n;
  };
  assert.equal(lit(0), 0);
  assert.equal(lit(0.5), 32);
  assert.equal(lit(1), 64);
});

test("a flat area is a stepped edge row and a body that fades toward the baseline", () => {
  const cols = 32;
  const rows = 32;
  const { fill, edge } = ditherCells({ cols, rows, series: [{ points: [[0, 0.25], [1, 0.25]] }] });
  const row = (a, r) => [...a.slice(r * cols, (r + 1) * cols)];
  assert.ok(row(edge, 8).every((v) => v === 0), "the line is one unbroken row");
  assert.ok(row(fill, 7).every((v) => v === -1), "nothing above the line");
  const count = (r) => row(fill, r).filter((v) => v === 0).length;
  const band = (from) => [0, 1, 2, 3, 4, 5, 6, 7].reduce((n, i) => n + count(from + i), 0);
  assert.ok(band(9) > band(16) && band(16) > band(24), "sparser toward the baseline (per 8-row Bayer block)");
  assert.equal(count(9), cols, "solid right under the line");
  assert.ok(count(31) <= cols / 8, "nearly empty at the baseline");
});

test("the fade follows each area's own height, so a low area still fades in full", () => {
  const cols = 8;
  const rows = 32;
  const { fill } = ditherCells({ cols, rows, series: [{ points: [[0, 0.75], [1, 0.75]] }] });
  const lit = (r) => [...fill.slice(r * cols, (r + 1) * cols)].filter((v) => v === 0).length;
  assert.equal(lit(25), cols);
  assert.ok(lit(31) < cols / 2);
});

test("a steep step stays connected and a dashed series leaves gaps", () => {
  const cols = 8;
  const rows = 16;
  const { edge } = ditherCells({ cols, rows, series: [{ points: [[0, 0.1], [0.5, 0.1], [0.5001, 0.9], [1, 0.9]] }] });
  const lit = (c) => [...Array(rows).keys()].filter((r) => edge[r * cols + c] === 0);
  assert.deepEqual(lit(4), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], "the drop is drawn down column 4");
  const dashed = ditherCells({ cols, rows, series: [{ points: [[0, 0.5], [1, 0.5]], dashed: true }] }).edge;
  assert.equal(dashed[8 * cols + 2], -1);
  assert.equal(dashed[8 * cols + 1], 0);
});
