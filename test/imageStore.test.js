import assert from "node:assert/strict";
import { test } from "node:test";
import { IMAGE_LIMITS, STORAGE_KEYS } from "../src/config.js";
import { createImageStore, dataUrlToBlob, fitWithin, validateImageFile } from "../src/imageStore.js";
import { createFakeChromeStorage, fakeImageRecord } from "./helpers.js";

test("validateImageFile accepts supported images and rejects others", () => {
  assert.equal(validateImageFile({ type: "image/png", size: 1000 }), null);
  assert.match(validateImageFile({ type: "image/svg+xml", size: 10 }), /PNG, JPEG/);
  assert.match(validateImageFile({ type: "image/jpeg", size: IMAGE_LIMITS.maxInputBytes + 1 }), /larger/);
  assert.match(validateImageFile(null), /No file/);
});

test("fitWithin downscales the longest edge and never upscales", () => {
  assert.deepEqual(fitWithin(4000, 2000, 1600), { width: 1600, height: 800 });
  assert.deepEqual(fitWithin(1000, 3000, 1600), { width: 533, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
});

test("dataUrlToBlob decodes base64 payloads", async () => {
  const blob = dataUrlToBlob(fakeImageRecord().dataUrl);
  assert.equal(blob.type, "image/webp");
  assert.equal(await blob.text(), "fake-webp-bytes");
});

test("image store saves, loads, and removes one local image", async () => {
  const storage = createFakeChromeStorage();
  const store = createImageStore(storage.area, storage.onChanged);
  assert.equal(await store.load(), null);

  await store.save(fakeImageRecord("sky.png"));
  const loaded = await store.load();
  assert.equal(loaded.name, "sky.png");
  assert.ok(storage.area.data.has(STORAGE_KEYS.image));

  await store.remove();
  assert.equal(await store.load(), null);
});

test("image store refuses oversized or non-image data", async () => {
  const storage = createFakeChromeStorage();
  const store = createImageStore(storage.area, storage.onChanged);
  const huge = { ...fakeImageRecord(), dataUrl: `data:image/webp;base64,${"A".repeat(IMAGE_LIMITS.maxStoredChars)}` };
  await assert.rejects(store.save(huge), /too large/);
  await assert.rejects(store.save({ ...fakeImageRecord(), dataUrl: "data:text/html,<script>" }), /not an image/);
  assert.equal(storage.area.data.size, 0);

  // A bad value written by something else is ignored on load.
  storage.area.data.set(STORAGE_KEYS.image, { dataUrl: "javascript:alert(1)" });
  assert.equal(await store.load(), null);
});
