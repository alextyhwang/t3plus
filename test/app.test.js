import assert from "node:assert/strict";
import { test } from "node:test";
import { T3PLUS, STORAGE_KEYS } from "../src/config.js";
import {
  createApp,
  createDom,
  createFakeChromeStorage,
  fakeImageRecord,
  settle,
  T3_APPEARANCE_HTML,
  T3_COMPOSER_HTML,
} from "./helpers.js";

const panelIn = (doc) => doc.getElementById(T3PLUS.panelId);
const modeOf = (doc) => doc.documentElement.getAttribute(T3PLUS.modeAttr);

function click(dom, el) {
  el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

function chooseMode(dom, panel, value) {
  const input = panel.querySelector(`input[type="radio"][value="${value}"]`);
  input.checked = true;
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

test("panel mounts after T3's last Appearance section and only on that route", async () => {
  const dom = createDom("/settings/appearance", T3_APPEARANCE_HTML);
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();

  const panel = panelIn(doc);
  assert.ok(panel, "panel inserted");
  assert.equal(panel.previousElementSibling.id, "appearance-interface");
  assert.equal(panel.parentElement.id, "page-container");

  dom.window.history.pushState({}, "", "/settings/general");
  app.watcher.flush();
  assert.equal(panelIn(doc), null, "removed when leaving Appearance");
  app.stop();
});

test("panel does not mount on other pages that happen to share section ids", async () => {
  const dom = createDom("/settings/general", T3_APPEARANCE_HTML);
  const { app } = createApp(dom);
  await app.start();
  assert.equal(panelIn(dom.window.document), null);
  app.stop();
});

test("panel is reinserted after T3 rerenders the Appearance page", async () => {
  const dom = createDom("/settings/appearance", T3_APPEARANCE_HTML);
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();

  // React rebuilds the page container from scratch.
  doc.querySelector("[data-settings-page-scroll]").innerHTML = T3_APPEARANCE_HTML.replace(
    /^\s*<div data-settings-page-scroll>|<\/div>\s*$/g,
    "",
  );
  await settle();
  assert.equal(panelIn(doc), null);
  app.watcher.flush();
  assert.equal(panelIn(doc)?.previousElementSibling.id, "appearance-interface");

  // A later section appended by T3 pushes t3+ back to the end.
  doc.getElementById("page-container").append(doc.createElement("section"));
  app.watcher.flush();
  assert.equal(doc.getElementById("page-container").lastElementChild.id, T3PLUS.panelId);
  app.stop();
});

test("controls switch modes, persist, and drive the composer theme", async () => {
  const dom = createDom("/settings/appearance", T3_APPEARANCE_HTML + T3_COMPOSER_HTML);
  const doc = dom.window.document;
  const { app, storage } = createApp(dom);
  await app.start();
  const panel = panelIn(doc);
  const imageRow = panel.querySelector(".t3plus-thumb").closest(".t3plus-row");
  const accentRow = panel.querySelector(".t3plus-color").closest(".t3plus-row");

  assert.equal(modeOf(doc), "half-circle");
  assert.equal(imageRow.hidden, true);
  assert.equal(accentRow.hidden, false);

  chooseMode(dom, panel, "image");
  await settle();
  assert.equal(modeOf(doc), "image");
  assert.equal(imageRow.hidden, false);
  assert.equal(accentRow.hidden, true);
  assert.match(doc.documentElement.style.getPropertyValue("--t3plus-image"), /assets\/sample-spectrum\.svg/);
  assert.equal(storage.area.data.get(STORAGE_KEYS.settings).composerGradient.mode, "image");

  const toggle = panel.querySelector('[role="switch"]');
  click(dom, toggle);
  await settle();
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.equal(modeOf(doc), null, "disabled removes the background");
  assert.ok(doc.documentElement.hasAttribute(T3PLUS.glassAttr), "glass is independent of the background");

  click(dom, toggle);
  chooseMode(dom, panel, "half-circle");
  await settle();
  assert.equal(modeOf(doc), "half-circle");

  // Slider drag previews without writing storage; release persists.
  const slider = panel.querySelector('input[type="range"]');
  slider.value = "90";
  slider.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-core"), "63%");
  assert.equal(storage.area.data.get(STORAGE_KEYS.settings).composerGradient.intensity, 45);
  slider.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await settle();
  assert.equal(storage.area.data.get(STORAGE_KEYS.settings).composerGradient.intensity, 90);

  // Custom accent, then back to theme.
  const color = panel.querySelector('input[type="color"]');
  color.value = "#ff3366";
  color.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await settle();
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-accent"), "#ff3366");
  click(dom, [...panel.querySelectorAll("button")].find((b) => b.textContent === "Theme"));
  await settle();
  assert.equal(doc.documentElement.style.getPropertyValue("--t3plus-accent"), "");

  // Reset.
  click(dom, [...panel.querySelectorAll("button")].find((b) => b.textContent === "Reset"));
  await settle();
  assert.equal(storage.area.data.get(STORAGE_KEYS.settings).composerGradient.intensity, 45);
  assert.equal(panel.querySelector('[role="status"]').textContent, "t3+ appearance reset.");
  app.stop();
});

test("settings survive a reload", async () => {
  const storage = createFakeChromeStorage();
  const first = createApp(createDom("/settings/appearance", T3_APPEARANCE_HTML), storage).app;
  await first.start();
  await first.actions.setMode("image");
  await first.actions.setIntensity(30);
  first.stop();

  const dom = createDom("/env/thread", T3_COMPOSER_HTML);
  const second = createApp(dom, storage).app;
  await second.start();
  assert.equal(modeOf(dom.window.document), "image");
  assert.equal(dom.window.document.documentElement.style.getPropertyValue("--t3plus-scrim-top"), "83%");
  assert.equal(dom.window.document.documentElement.style.getPropertyValue("--t3plus-scrim-bottom"), "73%");
  second.stop();
});

test("uploading an image stores it locally and uses it; removing falls back to the sample", async () => {
  const dom = createDom("/settings/appearance", T3_APPEARANCE_HTML);
  const doc = dom.window.document;
  const { app, storage } = createApp(dom, undefined, { prepareImage: async (file) => fakeImageRecord(file.name) });
  await app.start();
  await app.actions.setMode("image");

  await app.actions.chooseImage({ name: "mine.png", type: "image/png", size: 10 });
  assert.equal(storage.area.data.get(STORAGE_KEYS.image).name, "mine.png");
  assert.match(doc.documentElement.style.getPropertyValue("--t3plus-image"), /^url\("blob:/);
  assert.match(panelIn(doc).textContent, /Using mine\.png \(1600×900\)/);

  await app.actions.removeImage();
  assert.equal(storage.area.data.has(STORAGE_KEYS.image), false);
  assert.match(doc.documentElement.style.getPropertyValue("--t3plus-image"), /sample-spectrum\.svg/);
  app.stop();
});

test("a failed upload shows the error and keeps the previous image", async () => {
  const dom = createDom("/settings/appearance", T3_APPEARANCE_HTML);
  const { app, storage } = createApp(dom, undefined, {
    prepareImage: async () => {
      throw new Error("Use a PNG, JPEG, WebP, AVIF, or GIF image.");
    },
  });
  await app.start();
  await app.actions.chooseImage({ name: "doc.pdf", type: "application/pdf", size: 10 });
  assert.equal(panelIn(dom.window.document).querySelector('[role="status"]').textContent, "Use a PNG, JPEG, WebP, AVIF, or GIF image.");
  assert.equal(storage.area.data.has(STORAGE_KEYS.image), false);
  app.stop();
});

test("a change saved in one tab repaints another open tab", async () => {
  const storage = createFakeChromeStorage();
  const settingsTab = createApp(createDom("/settings/appearance", T3_APPEARANCE_HTML), storage).app;
  const chatDom = createDom("/env/thread", T3_COMPOSER_HTML);
  const chatTab = createApp(chatDom, storage).app;
  await settingsTab.start();
  await chatTab.start();

  await settingsTab.actions.setEnabled(false);
  assert.equal(modeOf(chatDom.window.document), null);
  await settingsTab.actions.setEnabled(true);
  assert.equal(modeOf(chatDom.window.document), "half-circle");
  settingsTab.stop();
  chatTab.stop();
});

test("stop removes every trace from the page", async () => {
  const dom = createDom("/settings/appearance", T3_APPEARANCE_HTML + T3_COMPOSER_HTML);
  const doc = dom.window.document;
  const { app, storage } = createApp(dom);
  await app.start();
  app.stop();
  assert.equal(panelIn(doc), null);
  assert.equal(modeOf(doc), null);
  assert.equal(doc.documentElement.getAttribute("style") ?? "", "");
  assert.equal(storage.onChanged.listenerCount(), 0);
});

test("an orphaned copy (extension reloaded) shuts itself down on the next check", async () => {
  const dom = createDom("/settings/appearance", T3_APPEARANCE_HTML);
  let alive = true;
  const { app } = createApp(dom, undefined, { isAlive: () => alive });
  await app.start();
  assert.ok(panelIn(dom.window.document));
  alive = false;
  app.watcher.flush();
  assert.equal(panelIn(dom.window.document), null);
});
