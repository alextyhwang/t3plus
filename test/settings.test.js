import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/config.js";
import { createSettingsStore, defaultSettings, normalizeSettings } from "../src/settings.js";
import { createFakeChromeStorage } from "./helpers.js";

test("normalizeSettings fills defaults for missing or corrupt values", () => {
  assert.deepEqual(normalizeSettings(undefined), defaultSettings());
  assert.deepEqual(normalizeSettings("garbage"), defaultSettings());
  const result = normalizeSettings({
    composerGradient: { enabled: "yes", mode: "spiral", accent: "red", intensity: "loud", imageSource: "web" },
  });
  assert.deepEqual(result.composerGradient, { ...DEFAULT_SETTINGS.composerGradient });
});

test("normalizeSettings keeps valid values and clamps intensity", () => {
  const result = normalizeSettings({
    composerGradient: { enabled: false, mode: "image", accent: "#AABBCC", intensity: 140.4, imageSource: "upload" },
  });
  assert.deepEqual(result.composerGradient, {
    enabled: false,
    mode: "image",
    accent: "#aabbcc",
    intensity: 100,
    imageSource: "upload",
    dither: true,
    ditherSize: "medium",
    ditherStyle: "bayer",
  });
  assert.equal(normalizeSettings({ composerGradient: { dither: false } }).composerGradient.dither, false);
  assert.equal(normalizeSettings({ composerGradient: { dither: "no" } }).composerGradient.dither, true);
  assert.equal(normalizeSettings({ composerGradient: { intensity: -3 } }).composerGradient.intensity, 0);
});

test("settings persist across store instances (a page reload)", async () => {
  const storage = createFakeChromeStorage();
  const first = createSettingsStore(storage.area, storage.onChanged);
  await first.updateGradient({ mode: "image", intensity: 80 });

  const second = createSettingsStore(storage.area, storage.onChanged);
  const loaded = await second.load();
  assert.equal(loaded.composerGradient.mode, "image");
  assert.equal(loaded.composerGradient.intensity, 80);
  assert.equal(loaded.composerGradient.enabled, true, "untouched fields keep their defaults");
  assert.ok(storage.area.data.has(STORAGE_KEYS.settings));
});

test("reset restores defaults and subscribe reports saves from another tab", async () => {
  const storage = createFakeChromeStorage();
  const tabA = createSettingsStore(storage.area, storage.onChanged);
  const tabB = createSettingsStore(storage.area, storage.onChanged);
  const seen = [];
  const unsubscribe = tabB.subscribe((settings) => seen.push(settings.composerGradient.mode));

  await tabA.updateGradient({ mode: "image" });
  await tabA.reset();
  unsubscribe();
  await tabA.updateGradient({ mode: "image" });

  assert.deepEqual(seen, ["image", "half-circle"]);
  assert.deepEqual(await tabB.load(), { ...defaultSettings(), composerGradient: { ...defaultSettings().composerGradient, mode: "image" } });
});

test("v1 settings (composerGradient only) upgrade with glass and sidebar defaults", () => {
  const v1 = { version: 1, composerGradient: { enabled: true, mode: "image", accent: "#112233", intensity: 40, imageSource: "upload" } };
  const result = normalizeSettings(v1);
  assert.equal(result.version, 2);
  assert.deepEqual(result.composerGradient, { ...v1.composerGradient, dither: true, ditherSize: "medium", ditherStyle: "bayer" });
  assert.deepEqual(result.glass, { enabled: true, strength: 85 });
  assert.deepEqual(result.sidebar, { profiles: true, bots: true, compactHeader: true, titleFirst: false });
  assert.deepEqual(normalizeSettings({ glass: { enabled: "no", strength: 400 } }).glass, { enabled: true, strength: 100 });
});
