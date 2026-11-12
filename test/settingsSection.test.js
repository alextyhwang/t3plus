import assert from "node:assert/strict";
import { test } from "node:test";
import { STORAGE_KEYS, T3PLUS } from "../src/config.js";
import { createApp, createDom, createFakeChromeStorage, settle, T3_APPEARANCE_HTML } from "./helpers.js";

// T3's Settings sidebar, as on app.t3.codes (ui/sidebar.tsx menu items).
const navItem = (path, label, active = false) => `
  <li data-slot="sidebar-menu-item" class="group/menu-item relative">
    <button type="button" class="peer/menu-button flex h-8 data-[active=true]:font-medium" data-slot="sidebar-menu-button"
      data-settings-section="${path}" data-active="${active}" role="treeitem"><svg></svg><span>${label}</span></button>
  </li>`;
const SETTINGS_HTML = `
  <div role="tree" aria-label="Settings sections"><ul data-slot="sidebar-menu" id="nav">
    ${navItem("/settings/general", "General")}
    ${navItem("/settings/appearance", "Appearance", true)}
    ${navItem("/settings/chat", "Chat")}
  </ul></div>
  ${T3_APPEARANCE_HTML}`;

const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const navButton = (doc) => doc.querySelector("[data-t3plus-settings-nav]");

test("t3+ has its own Settings entry after Appearance and opens as its own section", async () => {
  const dom = createDom("/settings/appearance", SETTINGS_HTML);
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();

  const button = navButton(doc);
  assert.ok(button, "nav entry inserted");
  assert.equal(button.textContent, "t3+");
  const items = [...doc.querySelectorAll("#nav > li")];
  assert.equal(items.indexOf(button.closest("li")), 2, "right after Appearance");
  assert.equal(button.className, doc.querySelector('[data-settings-section="/settings/appearance"]').className, "copies T3's classes");
  assert.equal(doc.getElementById(T3PLUS.panelId), null, "panel waits for the entry");

  click(dom, button);
  const panel = doc.getElementById(T3PLUS.panelId);
  assert.ok(panel, "panel shown");
  assert.equal(panel.parentElement.id, "page-container");
  assert.ok(doc.documentElement.hasAttribute(T3PLUS.settingsAttr));
  assert.equal(button.getAttribute("data-active"), "true");

  // A T3 settings link closes t3+ (T3 then navigates as usual).
  click(dom, doc.querySelector('[data-settings-section="/settings/chat"]'));
  assert.equal(doc.getElementById(T3PLUS.panelId), null);
  assert.ok(!doc.documentElement.hasAttribute(T3PLUS.settingsAttr));
  assert.equal(button.getAttribute("data-active"), "false");

  // Opening, then navigating elsewhere, closes it too.
  click(dom, button);
  assert.ok(doc.getElementById(T3PLUS.panelId));
  dom.window.history.pushState({}, "", "/settings/general");
  app.watcher.flush();
  assert.equal(doc.getElementById(T3PLUS.panelId), null);

  // Leaving Settings removes the entry; stop() cleans up.
  dom.window.history.pushState({}, "", "/");
  app.watcher.flush();
  assert.equal(navButton(doc), null);
  app.stop();
  assert.ok(!doc.documentElement.hasAttribute(T3PLUS.settingsAttr));
});

test("settings saved by v0.14 load unchanged, and the new title-first option defaults off", async () => {
  const storage = createFakeChromeStorage();
  const v14 = {
    version: 2,
    composerGradient: { enabled: true, mode: "half-circle", accent: "#112233", intensity: 60, imageSource: "sample", dither: true, ditherSize: "large", ditherStyle: "grain" },
    glass: { enabled: true, strength: 70 },
    sidebar: { profiles: false, bots: true, compactHeader: false },
    home: { widgets: false },
  };
  await storage.area.set({ [STORAGE_KEYS.settings]: v14 });
  const dom = createDom("/settings/appearance", SETTINGS_HTML);
  const doc = dom.window.document;
  const { app } = createApp(dom, storage);
  await app.start();
  click(dom, navButton(doc));
  const panel = doc.getElementById(T3PLUS.panelId);

  assert.equal(panel.querySelector('input[value="grain"]').checked, true, "look shows the saved dither style");
  assert.equal(panel.querySelector('input[value="large"]').checked, true, "pixel size kept");
  const switchFor = (label) => panel.querySelector(`[role="switch"][aria-label="${label}"]`);
  assert.equal(switchFor("Sidebar profile tabs").getAttribute("aria-checked"), "false");
  assert.equal(switchFor("Compact sidebar header").getAttribute("aria-checked"), "false");
  assert.equal(switchFor("Usage widgets").getAttribute("aria-checked"), "false");
  assert.equal(switchFor("Title first").getAttribute("aria-checked"), "false");
  assert.ok(!doc.documentElement.hasAttribute(T3PLUS.titleFirstAttr));

  // Smooth is the old "Pixel dither" off; the style underneath is kept.
  const smooth = panel.querySelector('input[value="smooth"]');
  smooth.checked = true;
  smooth.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await settle();
  const saved = storage.area.data.get(STORAGE_KEYS.settings);
  assert.equal(saved.composerGradient.dither, false);
  assert.equal(saved.composerGradient.ditherStyle, "grain");
  assert.equal(saved.composerGradient.accent, "#112233");

  click(dom, switchFor("Title first"));
  await settle();
  assert.equal(storage.area.data.get(STORAGE_KEYS.settings).sidebar.titleFirst, true);
  app.watcher.flush();
  assert.ok(doc.documentElement.hasAttribute(T3PLUS.titleFirstAttr));
  app.stop();
});

test("the toolbar icon's #t3plus link opens the t3+ section once", async () => {
  const dom = createDom("/settings/appearance#t3plus", SETTINGS_HTML);
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();
  app.watcher.flush();
  assert.ok(doc.getElementById(T3PLUS.panelId), "opened from the hash");
  click(dom, doc.querySelector('[data-settings-section="/settings/appearance"]'));
  app.watcher.flush();
  assert.equal(doc.getElementById(T3PLUS.panelId), null, "a T3 link still closes it");
  app.stop();
});
