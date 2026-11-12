import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildManifest } from "../build.mjs";
import { EXPORTED_KEYS, exportAll, importAll, mirrorToSync, restoreFromSync, SYNCED_KEYS } from "../src/backup.js";
import { STORAGE_KEYS } from "../src/config.js";
import { createFakeChromeStorage } from "./helpers.js";

test("the manifest pins the extension key, so every build has the same extension ID", async () => {
  const manifest = await buildManifest();
  assert.equal(typeof manifest.key, "string");
  const der = Buffer.from(manifest.key, "base64");
  const id = [...createHash("sha256").update(der).digest("hex").slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
  assert.equal(id, "nclfnobogafdmfohgibkgeefijieoeoc");
});

test("a fresh install restores preferences from Chrome Sync; existing local values win", async () => {
  const local = createFakeChromeStorage();
  const sync = createFakeChromeStorage();
  sync.area.data.set(STORAGE_KEYS.settings, { version: 2, glass: { enabled: true, strength: 70 } });
  sync.area.data.set(STORAGE_KEYS.bots, { "env1:bot1": { shape: "football", color: "orange" } });
  local.area.data.set(STORAGE_KEYS.profileView, { activeProfileId: "work" });
  sync.area.data.set(STORAGE_KEYS.profileView, { activeProfileId: "personal" });
  const restored = await restoreFromSync(local.area, sync.area);
  assert.deepEqual(restored.sort(), [STORAGE_KEYS.bots, STORAGE_KEYS.settings].sort());
  assert.equal(local.area.data.get(STORAGE_KEYS.settings).glass.strength, 70);
  assert.equal(local.area.data.get(STORAGE_KEYS.profileView).activeProfileId, "work", "local is never overwritten");
  assert.deepEqual(await restoreFromSync(local.area, null), []);
});

test("changes are mirrored to Chrome Sync, debounced, and oversized values stay local", async () => {
  const local = createFakeChromeStorage();
  const sync = createFakeChromeStorage();
  local.area.data.set(STORAGE_KEYS.settings, { version: 2, a: 1 });
  const timers = [];
  const stop = mirrorToSync({ local: local.area, sync: sync.area, changedEvent: local.onChanged, setTimer: (f) => timers.push(f) && timers.length, clearTimer: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  await local.area.set({ [STORAGE_KEYS.bots]: { "env1:b": { shape: "star", color: "green" } } });
  await local.area.set({ [STORAGE_KEYS.configLocal]: { use: "local", text: "x".repeat(9000) } });
  await local.area.set({ [STORAGE_KEYS.image]: { dataUrl: "data:image/webp;base64,AAAA" } });
  assert.equal(sync.area.data.size, 0, "nothing written until the debounce fires");
  await timers.at(-1)();
  assert.deepEqual(sync.area.data.get(STORAGE_KEYS.settings), { version: 2, a: 1 }, "existing values pushed once");
  assert.equal(sync.area.data.get(STORAGE_KEYS.bots)["env1:b"].shape, "star");
  assert.equal(sync.area.data.has(STORAGE_KEYS.configLocal), false, "too big for a Sync item");
  assert.equal(sync.area.data.has(STORAGE_KEYS.image), false, "images are never synced");
  stop();
  assert.ok(!SYNCED_KEYS.includes(STORAGE_KEYS.image));
});

test("export and import round-trip every preference, and reject other files", async () => {
  const a = createFakeChromeStorage();
  a.area.data.set(STORAGE_KEYS.settings, { version: 2, home: { widgets: false } });
  a.area.data.set(STORAGE_KEYS.image, { dataUrl: "data:image/webp;base64,AAAA", name: "bg.webp" });
  a.area.data.set(STORAGE_KEYS.homeFeedCache, { text: "{}" });
  const file = await exportAll(a.area, "0.14.0");
  assert.equal(file.app, "t3plus");
  assert.deepEqual(Object.keys(file.data).sort(), [STORAGE_KEYS.image, STORAGE_KEYS.settings].sort(), "caches are not exported");
  const b = createFakeChromeStorage();
  const keys = await importAll(b.area, JSON.parse(JSON.stringify(file)));
  assert.equal(keys.length, 2);
  assert.equal(b.area.data.get(STORAGE_KEYS.image).name, "bg.webp");
  await assert.rejects(importAll(b.area, { app: "other" }), /Not a t3\+ backup/);
  await assert.rejects(importAll(b.area, { app: "t3plus", data: { evil: 1 } }), /no t3\+ settings/);
  assert.ok(EXPORTED_KEYS.includes(STORAGE_KEYS.knownBots));
});

const fakePage = () => {
  const items = new Map();
  return { items, getItem: (k) => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, String(v)) };
};

test("preferences are also copied to T3's page storage, and a reinstall without Sync restores from it", async () => {
  const { PAGE_BACKUP_KEY, restoreBackups } = await import("../src/backup.js");
  const page = fakePage();
  const local = createFakeChromeStorage();
  local.area.data.set(STORAGE_KEYS.settings, { version: 2, sidebar: { titleFirst: true } });
  const timers = [];
  const stop = mirrorToSync({ local: local.area, sync: null, page, changedEvent: local.onChanged, setTimer: (f) => timers.push(f) && timers.length, clearTimer: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  await local.area.set({ [STORAGE_KEYS.bots]: { "env1:b": { shape: "star", color: "green" } } });
  await timers.at(-1)();
  stop();
  const saved = JSON.parse(page.items.get(PAGE_BACKUP_KEY));
  assert.equal(saved.data[STORAGE_KEYS.settings].sidebar.titleFirst, true);
  assert.equal(saved.data[STORAGE_KEYS.bots]["env1:b"].shape, "star");

  // The extension is removed and loaded again: its storage is empty, Sync has nothing.
  const fresh = createFakeChromeStorage();
  const restored = await restoreBackups(fresh.area, { sync: createFakeChromeStorage().area, page });
  assert.deepEqual(restored.sort(), [STORAGE_KEYS.bots, STORAGE_KEYS.settings].sort());
  assert.equal(fresh.area.data.get(STORAGE_KEYS.settings).sidebar.titleFirst, true);

  // Sync wins for a key it has; local values are never overwritten; a broken page copy is ignored.
  const sync = createFakeChromeStorage();
  sync.area.data.set(STORAGE_KEYS.settings, { version: 2, sidebar: { titleFirst: false } });
  const other = createFakeChromeStorage();
  other.area.data.set(STORAGE_KEYS.bots, { mine: { shape: "circle", color: "blue" } });
  await restoreBackups(other.area, { sync: sync.area, page });
  assert.equal(other.area.data.get(STORAGE_KEYS.settings).sidebar.titleFirst, false);
  assert.deepEqual(Object.keys(other.area.data.get(STORAGE_KEYS.bots)), ["mine"]);
  page.setItem(PAGE_BACKUP_KEY, "{not json");
  assert.deepEqual(await restoreBackups(createFakeChromeStorage().area, { page }), []);
});
