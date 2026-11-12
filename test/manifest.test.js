import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildManifest } from "../build.mjs";
import { T3_SELECTORS } from "../src/config.js";
import { BOT_FEED_ENDPOINT, CONFIG_ENDPOINTS, CONFIG_HOST_PERMISSIONS, DEFAULT_FEED_BASE, FETCH_ENDPOINTS, HOME_FEED_ENDPOINT, HOST_MATCHES, hostPermissionsFor } from "../src/hosts.js";

const css = await readFile(new URL("../src/styles/content.css", import.meta.url), "utf8");

test("manifest is MV3, storage-only, and scoped to the listed T3 hosts", async () => {
  const manifest = await buildManifest({ feedBase: DEFAULT_FEED_BASE });
  const text = JSON.stringify(manifest);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  // The only host permissions are the exact t3plus.json and t3plus-bots.json URLs, read by the background worker.
  assert.deepEqual(manifest.host_permissions, [...CONFIG_HOST_PERMISSIONS]);
  assert.deepEqual([...CONFIG_HOST_PERMISSIONS], [...CONFIG_ENDPOINTS, BOT_FEED_ENDPOINT, HOME_FEED_ENDPOINT]);
  assert.deepEqual([...FETCH_ENDPOINTS], [...CONFIG_HOST_PERMISSIONS]);
  for (const url of FETCH_ENDPOINTS) assert.match(url, /^https:\/\/[a-z0-9.-]+\/[^*]+\.json$/, "exact file URL, no wildcard");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(!text.includes("<all_urls>"));
  const own = await buildManifest({ feedBase: "https://files.example.com/t3/" });
  assert.deepEqual(own.host_permissions, hostPermissionsFor("https://files.example.com/t3/"));
  assert.equal(own.host_permissions[0], "https://files.example.com/t3/t3plus.json", "a configured feed folder becomes exact file permissions");
  assert.ok(!text.includes("__HOST_MATCHES__"));
  assert.ok(!text.includes("__CONFIG_HOST_PERMISSIONS__"));
  assert.deepEqual(manifest.content_scripts[0].matches, [...HOST_MATCHES]);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, [...HOST_MATCHES]);
  for (const match of HOST_MATCHES) assert.match(match, /^https:\/\/[a-z0-9.-]+\/\*$/);
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

test("the hero glow crossfade scales match HERO_SPREAD", async () => {
  const { HERO_SPREAD } = await import("../src/backdropRenderer.js");
  assert.ok(css.includes(`transform: scale(${HERO_SPREAD});`), "wide layer's resting size for the normal glow");
  assert.ok(css.includes(`transform: scale(${(1 / HERO_SPREAD).toFixed(2)});`), "normal glow's size for the wide layer");
});
