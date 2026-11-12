import assert from "node:assert/strict";
import { test } from "node:test";
import { computeComposerTheme, cssEscapeUrl } from "../src/gradient.js";
import { normalizeSettings } from "../src/settings.js";

const settings = (patch) => normalizeSettings({ composerGradient: patch });

test("half-circle mode follows the theme accent by default", () => {
  const theme = computeComposerTheme(settings({ mode: "half-circle", intensity: 50 }), "chrome-extension://x/a.svg");
  assert.equal(theme.mode, "half-circle");
  assert.equal(theme.vars["--t3plus-dither-cell"], "2px", "medium pixel size is shared by every surface");
  assert.equal(theme.vars["--t3plus-accent"], null, "unset accent means var(--primary) in CSS");
  assert.equal(theme.vars["--t3plus-core"], "35%");
  assert.equal(theme.vars["--t3plus-halo"], "23%");
  assert.equal(theme.vars["--t3plus-fade"], "9%");
});

test("pixel size follows the selected dither grid", () => {
  assert.equal(computeComposerTheme(settings({ ditherSize: "fine" }), null).vars["--t3plus-dither-cell"], `${4 / 3}px`);
  assert.equal(computeComposerTheme(settings({ ditherSize: "large" }), null).vars["--t3plus-dither-cell"], "3px");
});

test("custom accent and intensity map to CSS variables", () => {
  const theme = computeComposerTheme(settings({ accent: "#ff8800", intensity: 100 }), null);
  assert.equal(theme.vars["--t3plus-accent"], "#ff8800");
  assert.equal(theme.vars["--t3plus-core"], "70%");
  const off = computeComposerTheme(settings({ intensity: 0 }), null);
  assert.equal(off.vars["--t3plus-core"], "0%");
  assert.equal(off.vars["--t3plus-scrim-top"], "100%");
  assert.equal(off.vars["--t3plus-scrim-bottom"], "100%");
});

test("image mode exposes the image URL and a top-heavy scrim", () => {
  const theme = computeComposerTheme(settings({ mode: "image", intensity: 60 }), "blob:https://app.t3.codes/1");
  assert.equal(theme.mode, "image");
  assert.equal(theme.vars["--t3plus-image"], 'url("blob:https://app.t3.codes/1")');
  assert.equal(theme.vars["--t3plus-scrim-top"], "67%");
  assert.equal(theme.vars["--t3plus-scrim-bottom"], "46%");
});

test("glass is on by default and strength maps to opacity and blur", () => {
  const theme = computeComposerTheme(normalizeSettings({}), null);
  assert.equal(theme.glass, true);
  assert.equal(theme.vars["--t3plus-glass-opacity"], "37%", "default strength 85");
  assert.equal(theme.vars["--t3plus-glass-blur"], "22px");
  const clear = computeComposerTheme(normalizeSettings({ glass: { strength: 100 } }), null);
  assert.equal(clear.vars["--t3plus-glass-opacity"], "28%", "stronger glass keeps less of the card color");
  const solid = computeComposerTheme(normalizeSettings({ glass: { enabled: false, strength: 0 } }), null);
  assert.equal(solid.glass, false);
  assert.equal(solid.vars["--t3plus-glass-opacity"], "88%");
});

test("image mode without an image paints nothing", () => {
  assert.equal(computeComposerTheme(settings({ mode: "image" }), null).mode, null);
});

test("disabled gradient clears the mode", () => {
  assert.equal(computeComposerTheme(settings({ enabled: false }), "x").mode, null);
});

test("cssEscapeUrl prevents breaking out of url()", () => {
  assert.equal(cssEscapeUrl('a"b\\c'), 'a\\"b\\\\c');
});

test("re-rendering the theme never resets the measured composer anchor (no glow jump on thread switch)", async () => {
  const { JSDOM } = await import("jsdom");
  const { applyComposerTheme, syncBackdropAnchor } = await import("../src/composer.js");
  const theme = computeComposerTheme(settings({ mode: "half-circle" }), null);
  assert.equal("--t3plus-composer-x" in theme.vars, false, "the theme does not own the anchor");

  const dom = new JSDOM(`<div data-workspace-area="conversation"><div data-chat-composer-surface="true"></div></div>
    <div data-chat-composer-surface="true" id="stray"></div>`);
  const doc = dom.window.document;
  const rect = (left, width) => () => ({ left, width, top: 0, height: 10, right: left + width, bottom: 10 });
  const host = doc.querySelector('[data-workspace-area="conversation"]');
  const composer = host.firstElementChild;
  host.getBoundingClientRect = rect(300, 1000);
  composer.getBoundingClientRect = rect(500, 600); // center 800 -> 50% of the pane
  doc.getElementById("stray").getBoundingClientRect = rect(0, 100);
  // A stray composer outside the pane comes first in the document; it must be ignored.
  doc.body.prepend(doc.getElementById("stray"));
  assert.equal(syncBackdropAnchor(doc), true);
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-composer-x"), "50.00%");

  composer.getBoundingClientRect = rect(700, 600);
  syncBackdropAnchor(doc);
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-composer-x"), "70.00%");
  applyComposerTheme(doc, theme); // e.g. a storage echo after the thread switch
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-composer-x"), "70.00%", "render keeps the anchor");

  // A composer that is mid-mount (not laid out) keeps the last good value.
  composer.getBoundingClientRect = rect(300, 0);
  assert.equal(syncBackdropAnchor(doc), false);
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-composer-x"), "70.00%");
});

test("the glow centers on T3's composer even though the composer overlay is a sibling of the pane (details panel open)", async () => {
  const { JSDOM } = await import("jsdom");
  const { syncBackdropAnchor } = await import("../src/composer.js");
  // ChatView.tsx: <div data-workspace-area="conversation"> and the composer overlay are siblings.
  const dom = new JSDOM(`<div id="col"><div data-workspace-area="conversation"></div>
    <div data-chat-composer-overlay="true"><div data-chat-composer-surface="true" id="card"></div></div></div>`);
  const doc = dom.window.document;
  const rect = (left, width) => () => ({ left, width, top: 0, height: 10, right: left + width, bottom: 10 });
  doc.querySelector('[data-workspace-area="conversation"]').getBoundingClientRect = rect(300, 1400);
  doc.getElementById("card").getBoundingClientRect = rect(400, 700); // centered in the lane left of the details panel
  assert.equal(syncBackdropAnchor(doc), true);
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-composer-x"), "32.14%");
});
