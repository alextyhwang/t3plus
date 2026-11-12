import assert from "node:assert/strict";
import { test } from "node:test";
import { T3PLUS } from "../src/config.js";
import { providerKind } from "../src/homeData.js";
import { createApp, createDom } from "./helpers.js";

test("providerKind reads the composer's model picker label", () => {
  assert.equal(providerKind("Claude Opus 5.5, High"), "claude");
  assert.equal(providerKind("Fable 5.1"), "claude");
  assert.equal(providerKind("GPT-6.1 Sol, High"), "codex");
  assert.equal(providerKind("Codex Mini"), "codex");
  assert.equal(providerKind("Gemini 3 Pro"), null);
  assert.equal(providerKind(null), null);
});

// ThreadDetailsPanel: the card with T3's "Usage limits" section, and the composer's model picker.
const detailsHtml = (model) => `
  <aside data-workspace-area="details"><div data-thread-details-card="true" class="dropdown-glass">
    <section aria-label="Workspace"><div></div><div>studio-mac</div></section>
    <section aria-label="Usage limits"><div class="hidden"><h3>Usage limits</h3></div>
      <div class="grid" id="t3-usage-rows"><div aria-label="Weekly: 58% left">Weekly 58%</div></div></section>
  </div></aside>
  <div data-chat-composer-footer="true"><button data-chat-provider-model-picker="true" aria-label="${model}">${model}</button></div>`;

test("thread details: the current provider's pool replaces T3's usage rows; other providers keep T3's", async () => {
  const dom = createDom("/env1/a1", detailsHtml("Claude Opus 5.5, High"));
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();
  app.watcher.flush();
  const section = doc.querySelector('section[aria-label="Usage limits"]');
  assert.equal(section.getAttribute(T3PLUS.detailsPoolAttr), "claude");
  const pool = section.querySelector(".t3plus-details-pool");
  assert.ok(pool, "pool inserted into T3's section");
  assert.equal(pool.querySelector(".t3plus-w").getAttribute("aria-label"), "Claude pool");
  assert.ok(doc.getElementById("t3-usage-rows"), "T3's rows stay in the DOM (hidden by CSS)");

  // Switching the composer to a Codex model switches the card.
  doc.querySelector("[data-chat-provider-model-picker]").setAttribute("aria-label", "GPT-6.1 Sol, High");
  app.watcher.flush();
  assert.equal(section.getAttribute(T3PLUS.detailsPoolAttr), "codex");
  assert.equal(section.querySelector(".t3plus-w").getAttribute("aria-label"), "Codex pool");

  // A provider without a pool: T3's own rows.
  doc.querySelector("[data-chat-provider-model-picker]").setAttribute("aria-label", "Gemini 3 Pro");
  app.watcher.flush();
  assert.ok(!section.hasAttribute(T3PLUS.detailsPoolAttr));
  assert.equal(section.querySelector(".t3plus-details-pool"), null);

  app.stop();
});

test("thread details pool follows the Home widgets setting and is cleaned up on stop", async () => {
  const dom = createDom("/env1/a1", detailsHtml("Claude Opus 5.5, High"));
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();
  app.watcher.flush();
  assert.ok(doc.querySelector(".t3plus-details-pool"));
  app.actions.setHomeWidgets(false);
  await new Promise((r) => setTimeout(r, 0));
  app.watcher.flush();
  assert.equal(doc.querySelector(".t3plus-details-pool"), null);
  app.stop();
  assert.equal(doc.querySelector(`[${T3PLUS.detailsPoolAttr}]`), null);
});
