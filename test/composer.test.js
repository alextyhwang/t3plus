import assert from "node:assert/strict";
import { test } from "node:test";
import { applyComposerTheme, BACKDROP_HOST_SELECTOR, PAINTED_SURFACE_SELECTOR, syncComposerSurfaces } from "../src/composer.js";
import { T3PLUS } from "../src/config.js";
import { createApp, createDom, settle, T3_COMPOSER_HTML } from "./helpers.js";

test("applyComposerTheme sets and clears html attributes and variables", () => {
  const dom = createDom("/", "");
  const doc = dom.window.document;
  applyComposerTheme(doc, { mode: "half-circle", glass: true, vars: { "--t3plus-core": "30%", "--t3plus-accent": "#112233" } });
  assert.equal(doc.documentElement.getAttribute(T3PLUS.modeAttr), "half-circle");
  assert.ok(doc.documentElement.hasAttribute(T3PLUS.glassAttr));
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-accent"), "#112233");

  applyComposerTheme(doc, { mode: null, glass: false, vars: { "--t3plus-core": null, "--t3plus-accent": null } });
  assert.equal(doc.documentElement.hasAttribute(T3PLUS.modeAttr), false);
  assert.equal(doc.documentElement.hasAttribute(T3PLUS.glassAttr), false);
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-accent"), "");
});

test("the backdrop host is the conversation pane, never the composer card, and JS paints nothing inline", async () => {
  const html = `<div data-workspace-area="conversation" role="region">${T3_COMPOSER_HTML}</div>`;
  const dom = createDom("/env/thread", html);
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();
  const pane = doc.querySelector('[data-workspace-area="conversation"]');
  const card = doc.querySelector('[data-chat-composer-surface="true"]');
  assert.ok(pane.matches(BACKDROP_HOST_SELECTOR));
  assert.equal(card.matches(BACKDROP_HOST_SELECTOR), false);
  assert.equal(card.getAttribute("style"), null);
  assert.equal(pane.getAttribute("style"), null);
  assert.equal(doc.documentElement.getAttribute(T3PLUS.modeAttr), "half-circle");
  assert.ok(doc.documentElement.hasAttribute(T3PLUS.glassAttr));
  app.stop();
});

test("the current T3 composer surface is painted without any tagging", () => {
  const dom = createDom("/env/thread", T3_COMPOSER_HTML);
  const doc = dom.window.document;
  const result = syncComposerSurfaces(doc, true);
  assert.deepEqual(result, { surfaces: 1, tagged: 0, orphanEditors: 0 });
  assert.ok(doc.querySelector('[data-chat-composer-surface="true"]').matches(PAINTED_SURFACE_SELECTOR));
});

test("fallback tags the body's parent when the surface hook disappears, and untags when disabled", () => {
  const dom = createDom("/env/thread", T3_COMPOSER_HTML.replace(' data-chat-composer-surface="true"', ""));
  const doc = dom.window.document;
  const card = doc.querySelector('[data-chat-composer-body="true"]').parentElement;

  assert.equal(syncComposerSurfaces(doc, true).tagged, 1);
  assert.ok(card.matches(PAINTED_SURFACE_SELECTOR));

  syncComposerSurfaces(doc, false);
  assert.equal(card.hasAttribute(T3PLUS.surfaceAttr), false);
});

test("a chat composer editor with neither hook is reported, not guessed at", () => {
  const dom = createDom("/", '<div data-chat-composer-overlay="true"><div><div data-testid="composer-editor"></div></div></div>');
  assert.equal(syncComposerSurfaces(dom.window.document, true).orphanEditors, 1);
});

test("T3's editor reused outside the chat (Settings > Appearance font preview) is not a broken composer", () => {
  // Shape of the live Settings page (2026-11-12): the editor sits in a settings row.
  const dom = createDom("/settings/appearance", `
    <div data-settings-page-scroll="true"><section><div data-slot="settings-group"><div data-slot="settings-row">
      <div class="mt-1 mb-2 rounded-lg border"><div class="relative flow-root"><div><div data-testid="composer-editor"></div></div></div></div>
    </div></div></section></div>`);
  assert.equal(syncComposerSurfaces(dom.window.document, true).orphanEditors, 0);
});

test("composer remounts are repainted after the throttled check", async () => {
  // Fallback path: the only one that needs JS after a React remount.
  const html = T3_COMPOSER_HTML.replace(' data-chat-composer-surface="true"', "");
  const dom = createDom("/env/thread", html);
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();

  const overlay = doc.querySelector('[data-chat-composer-overlay="true"]');
  assert.ok(overlay.querySelector(PAINTED_SURFACE_SELECTOR));

  // React replaces the whole composer subtree.
  overlay.innerHTML = html.replace(/^\s*<div data-chat-composer-overlay="true">|<\/div>\s*$/g, "");
  await settle();
  const fresh = doc.querySelector('[data-chat-composer-body="true"]').parentElement;
  assert.equal(fresh.matches(PAINTED_SURFACE_SELECTOR), false, "not tagged before the check runs");

  app.watcher.flush();
  assert.ok(fresh.matches(PAINTED_SURFACE_SELECTOR));
  assert.equal(doc.documentElement.getAttribute(T3PLUS.modeAttr), "half-circle");
  app.stop();
});

test("without T3's conversation hook, the composer overlay's parent becomes the backdrop host", async () => {
  const dom = createDom("/env/thread", `<div id="pane">${T3_COMPOSER_HTML}</div>`);
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();
  const pane = doc.getElementById("pane");
  assert.ok(pane.matches(BACKDROP_HOST_SELECTOR));
  await app.actions.setEnabled(false);
  app.watcher.flush();
  assert.equal(pane.hasAttribute(T3PLUS.backdropHostAttr), false, "untagged when the background is off");
  await app.actions.setEnabled(true);
  app.watcher.flush();
  assert.ok(pane.hasAttribute(T3PLUS.backdropHostAttr));
  app.stop();
  assert.equal(pane.hasAttribute(T3PLUS.backdropHostAttr), false);
});
