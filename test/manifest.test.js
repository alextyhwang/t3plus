import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { T3_SELECTORS } from "../src/config.js";
// The shipped setup, not the test fixture (test/support/register.mjs).
import { FEED_BASE, IMMICH, T3_ORIGIN, TASKS_BASE } from "../src/personal.js?shipped";

const css = await readFile(new URL("../src/styles/content.css", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest is MV3, storage-only, runs only on T3 and grants every origin t3+ requests", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.content_scripts[0].matches, [`${T3_ORIGIN}/*`]);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, [`${T3_ORIGIN}/*`]);
  assert.equal(manifest.background.service_worker, "background.js");
  const granted = manifest.host_permissions.map((permission) => {
    assert.match(permission, /^https:\/\/[a-z0-9.-]+\/\*$/, "whole origins only, never <all_urls>");
    return new URL(permission).origin;
  });
  for (const url of [FEED_BASE, TASKS_BASE, IMMICH.feedEndpoint, IMMICH.imageEndpoint].filter(Boolean)) {
    assert.ok(granted.includes(new URL(url).origin), `no host permission for ${url}`);
  }
});

test("the manifest pins the extension key, so every build has the same extension ID", () => {
  const der = Buffer.from(manifest.key, "base64");
  const id = [...createHash("sha256").update(der).digest("hex").slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
  assert.equal(id, "nclfnobogafdmfohgibkgeefijieoeoc");
});

test("content.css uses the same hooks that config.js names", () => {
  assert.ok(css.includes(T3_SELECTORS.composerSurface));
  assert.ok(css.includes(T3_SELECTORS.composerShell));
  assert.ok(css.includes(T3_SELECTORS.conversationArea));
  assert.ok(css.includes("[data-t3plus-surface]"));
});

test("home chart surfaces use the shared dither pixel grid", () => {
  assert.match(css, /--t3plus-dither-cell/);
  assert.match(css, /\.t3plus-w-dither\s*\{[^}]*image-rendering:\s*pixelated/);
  assert.match(css, /\[data-t3plus-dithered\][^{]*\.t3plus-w-area/, "the SVG fill hides once the canvas paints");
  assert.match(css, /\[data-t3plus-usage-plot\]\[data-t3plus-dithered\] > svg path/, "T3's Usage chart hides its own fills only once painted");
  assert.match(css, /\.t3plus-w-cell[\s\S]*background-size:\s*calc\(var\(--t3plus-dither-cell/);
  assert.match(css, /\.t3plus-profile-dot[\s\S]*image-rendering:\s*pixelated/);
  assert.match(css, /shape-rendering:\s*crispEdges/);
});

/** Rule blocks (selector + body) whose selector list mentions `needle`. Ignores @-rule wrappers. */
const blocksFor = (needle) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.replace(/\/\*[\s\S]*?\*\//g, "").trim(), body }))
    .filter(({ sel }) => sel.includes(needle));

test("background vs glass: the image and gradient are a backdrop layer; the composer card is glass", () => {
  // Every rule that paints the image or the half-circle does it on a ::before (or the wide glow's ::after) layer, never on the card.
  const painters = [...blocksFor("data-t3plus-backdrop"), ...blocksFor(".t3plus-preview[data-backdrop")].filter((b) => /background-image/.test(b.body));
  assert.ok(painters.length >= 3);
  for (const { sel } of painters) {
    for (const part of sel.split(/,\s*(?=html|\.t3plus)/)) {
      assert.match(part, /::(before|after)\s*$/, `painted on a layer: ${part}`);
      assert.doesNotMatch(part, /composer-surface|t3plus-surface|composer-shell/, "never on the composer card");
    }
  }
  const layer = blocksFor('[data-workspace-area="conversation"]').find((b) => b.sel.includes("::before") && /position:\s*absolute/.test(b.body));
  assert.ok(layer, "backdrop layer rule exists");
  assert.match(layer.body, /pointer-events:\s*none/);
  assert.match(layer.body, /z-index:\s*-1/);

  // The card: translucent theme color + backdrop blur, never an image.
  const glass = blocksFor("[data-t3plus-glass]").find((b) => /backdrop-filter/.test(b.body) && !/none/.test(b.body));
  assert.ok(glass, "glass rule exists");
  assert.match(glass.body, /background-color:\s*color-mix\(in srgb, var\(--card[^;]*transparent\)/);
  assert.doesNotMatch(glass.body, /background-image|url\(/);
  // T3's own shell glass is tuned through its variables, not replaced.
  const shell = blocksFor('[data-slot="composer-shell"]').find((b) => /--glass-opacity/.test(b.body));
  assert.match(shell.body, /--glass-opacity:\s*var\(--t3plus-glass-opacity/);
  // Opaque fallbacks.
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
});

test("content.css animates only bot faces (stepped sprites, off under reduced motion) and keeps fallbacks", () => {
  assert.deepEqual([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]), ["t3plus-bot-sprite"]);
  const animations = [...css.matchAll(/animation\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(animations.every((a) => a === "none" || /^t3plus-bot-sprite .*steps\(/.test(a)), animations.join(" | "));
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.t3plus-bot-avatar\[data-animated\]::before,[^}]*animation:\s*none/);
  assert.doesNotMatch(css, /feTurbulence/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("profile filtering hides rows with an !important display rule tied to t3+'s own attribute", () => {
  assert.match(css, /\[data-t3plus-filtered\]\[hidden\]\s*\{\s*display:\s*none !important;/);
});

test("the hero glow swaps sprites on one layer without a navigation animation", () => {
  const wide = css.match(/html\[data-t3plus-glow-wide\][^{]+::before\s*\{([^}]+)\}/)?.[1];
  assert.ok(wide, "wide glow uses the existing backdrop layer");
  assert.match(wide, /background-image: var\(--t3plus-wide-image\)/);
  assert.match(wide, /background-size: var\(--t3plus-wide-w\) var\(--t3plus-wide-h\)/);
  assert.doesNotMatch(css, /data-t3plus-glow-ready|@property --t3plus-glow/);
  assert.doesNotMatch(wide, /transition|transform|opacity/);
});
