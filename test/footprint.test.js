// Work t3+ leaves undone when nothing changed: hidden tabs, unchanged feeds and
// preferences, glow renders that would draw the same pixels, and bot faces
// animated off the main thread.
import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { assembleApng, pngChunks } from "../src/apng.js";
import { mirrorToSync, PAGE_BACKUP_KEY } from "../src/backup.js";
import { createBackdropRenderer } from "../src/backdropRenderer.js";
import { botArt, setBotArtEncoder } from "../src/botArt.js";
import { createBotFeed } from "../src/botFeed.js";
import { applyAvatarVars, resolveBotPresentation } from "../src/bots.js";
import { STORAGE_KEYS } from "../src/config.js";
import { createDomWatcher } from "../src/domWatcher.js";
import { createHomeFeed } from "../src/homeData.js";
import { defaultSettings } from "../src/settings.js";
import { createDom, createFakeChromeStorage, createFakeRemote, settle } from "./helpers.js";

const setVisibility = (doc, state) => {
  Object.defineProperty(doc, "visibilityState", { configurable: true, value: state });
  doc.dispatchEvent(new doc.defaultView.Event("visibilitychange"));
};

test("a hidden tab runs no DOM checks; showing it checks once, at once", async () => {
  const dom = createDom("/", "<nav id='sidebar'></nav>");
  const doc = dom.window.document;
  let checks = 0;
  const watcher = createDomWatcher({ win: dom.window, doc, check: () => (checks += 1), throttleMs: 0 });
  watcher.start();
  assert.equal(checks, 1);

  setVisibility(doc, "hidden");
  for (let i = 0; i < 5; i += 1) doc.getElementById("sidebar").append(doc.createElement("li"));
  watcher.schedule();
  await settle();
  await settle();
  assert.equal(checks, 1, "nothing runs while hidden");

  setVisibility(doc, "visible");
  assert.equal(checks, 2, "one check before the tab paints again");
  doc.getElementById("sidebar").append(doc.createElement("li"));
  await settle();
  await settle();
  assert.equal(checks, 3, "watching again");
  watcher.stop();
  setVisibility(doc, "hidden");
  setVisibility(doc, "visible");
  assert.equal(checks, 3, "a stopped watcher ignores visibility");
});

const countingSets = (area) => {
  const writes = [];
  const set = area.set.bind(area);
  area.set = async (items) => {
    writes.push(Object.keys(items));
    return set(items);
  };
  return writes;
};

test("an unchanged feed poll does not rewrite its cache", async () => {
  const botText = JSON.stringify({ version: 1, bots: { bot1: { text: "Done.", role: "assistant" } } });
  for (const [make, text, key] of [
    [createBotFeed, botText, STORAGE_KEYS.botFeedCache],
    [createHomeFeed, JSON.stringify({ version: 1, generatedAt: "2026-11-16T00:00:00Z" }), STORAGE_KEYS.homeFeedCache],
  ]) {
    const storage = createFakeChromeStorage();
    const writes = countingSets(storage.area);
    const remote = createFakeRemote({ ok: true, status: 200, text });
    const feed = make({ area: storage.area, fetchRemote: remote });
    assert.ok(await feed.load());
    assert.ok(await feed.load());
    assert.deepEqual(writes, [[key]], "written once");
    remote.response = { ok: true, status: 200, text: text.replace("}", ', "extra": 1}') };
    assert.ok(await feed.load());
    assert.equal(writes.length, 2, "a changed feed is written");

    // A new tab reads the cache first; the same text from the server is not written again.
    const tab = make({ area: storage.area, fetchRemote: remote });
    await tab.readCache();
    await tab.load();
    assert.equal(writes.length, 2);
  }
});

test("Chrome Sync and the page copy are written only when a value differs from what they hold", async () => {
  const local = createFakeChromeStorage();
  const sync = createFakeChromeStorage();
  const syncWrites = countingSets(sync.area);
  const pageWrites = [];
  const items = new Map();
  const page = { getItem: (k) => (items.has(k) ? items.get(k) : null), setItem: (k, v) => (pageWrites.push(k), items.set(k, String(v))) };
  local.area.data.set(STORAGE_KEYS.settings, { version: 2, a: 1 });
  local.area.data.set(STORAGE_KEYS.bots, { "env1:b": { shape: "star", color: "green" } });
  const timers = [];
  const open = () => mirrorToSync({ local: local.area, sync: sync.area, page, changedEvent: local.onChanged, setTimer: (f) => timers.push(f) && timers.length, clearTimer: () => {} });

  let stop = open();
  await settle();
  await timers.at(-1)();
  assert.deepEqual(syncWrites.map((keys) => keys.sort()), [[STORAGE_KEYS.bots, STORAGE_KEYS.settings].sort()], "first run pushes both");
  assert.equal(pageWrites.length, 1);
  stop();

  // The next page load (or another tab) finds the same values everywhere.
  stop = open();
  await settle();
  await timers.at(-1)();
  assert.equal(syncWrites.length, 1, "nothing written to Sync");
  assert.equal(pageWrites.length, 1, "page copy not rewritten");

  await local.area.set({ [STORAGE_KEYS.settings]: { version: 2, a: 2 } });
  await timers.at(-1)();
  assert.deepEqual(syncWrites.at(-1), [STORAGE_KEYS.settings], "only the changed key");
  assert.equal(sync.area.data.get(STORAGE_KEYS.settings).a, 2);
  assert.equal(JSON.parse(items.get(PAGE_BACKUP_KEY)).data[STORAGE_KEYS.settings].a, 2);
  stop();
});

/** A real PNG file of solid `rgb`, `width` x `height`. */
function solidPng(width, height, rgb) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) Buffer.from(rgb).copy(raw, y * (1 + width * 3) + 1 + x * 3);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

test("an APNG holds every frame's image data in order, each shown for the frame time, looping", () => {
  const frames = [[255, 0, 0], [0, 255, 0], [0, 0, 255]].map((rgb) => solidPng(4, 4, rgb));
  const apng = assembleApng(frames, 175);
  const chunks = pngChunks(apng);
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "fcTL", "fdAT", "IEND"]);
  // Every chunk's CRC checks out.
  const view = new DataView(apng.buffer);
  for (let at = 8; at < apng.length; ) {
    const length = view.getUint32(at);
    assert.equal(view.getUint32(at + 8 + length), crc32(apng.subarray(at + 4, at + 8 + length)));
    at += 12 + length;
  }
  const u32 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);
  const u16 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(at);
  const actl = chunks[1].data;
  assert.deepEqual([u32(actl, 0), u32(actl, 4)], [3, 0], "3 frames, plays forever");
  const controls = chunks.filter((c) => c.type === "fcTL").map((c) => c.data);
  assert.deepEqual(controls.map((d) => [u32(d, 4), u32(d, 8), u16(d, 20), u16(d, 22), d[24], d[25]]), Array(3).fill([4, 4, 175, 1000, 0, 0]));
  const sequence = chunks.filter((c) => c.type === "fcTL" || c.type === "fdAT").map((c) => u32(c.data, 0));
  assert.deepEqual(sequence, [0, 1, 2, 3, 4]);
  const image = (png) => pngChunks(png).find((c) => c.type === "IDAT").data;
  assert.deepEqual([chunks[3].data, chunks[5].data.subarray(4), chunks[7].data.subarray(4)].map((d) => [...d]), frames.map((f) => [...image(f)]));

  assert.equal(assembleApng([frames[0], solidPng(5, 4, [0, 0, 0])], 175), null, "frames of different sizes");
  assert.equal(assembleApng([frames[0], new Uint8Array([1, 2, 3])], 175), null, "not a PNG");
});

test("animated faces carry the encoder's animated PNG; the avatar shows it instead of stepping the sheet", () => {
  const calls = [];
  setBotArtEncoder((pixels, width, height, fills, timing) => {
    calls.push(timing);
    return { sheet: "data:image/png;base64,SHEET", motion: timing.frames > 1 ? "data:image/png;base64,MOTION" : null };
  });
  try {
    const working = botArt("blue", "circle", "working");
    assert.equal(working.url, 'url("data:image/png;base64,SHEET")');
    assert.equal(working.motion, 'url("data:image/png;base64,MOTION")');
    assert.deepEqual(calls[0], { frames: working.frames, frameMs: (working.duration * 1000) / working.frames });
    assert.equal(botArt("blue", "circle", "idle").motion, null);

    const dom = createDom("/", "<span id='a'></span>");
    const el = dom.window.document.getElementById("a");
    applyAvatarVars(el, resolveBotPresentation({ key: "env1:b", status: "working" }, { color: "blue", shape: "circle" }));
    assert.equal(el.getAttribute("data-animated"), "image");
    assert.equal(el.style.getPropertyValue("--t3plus-bot-motion"), working.motion);
    assert.equal(el.style.getPropertyValue("--t3plus-bot-fill"), working.url, "the sheet stays for reduced motion");
    applyAvatarVars(el, resolveBotPresentation({ key: "env1:b", status: "idle" }, { color: "blue", shape: "circle" }));
    assert.equal(el.hasAttribute("data-animated"), false);
    assert.equal(el.style.getPropertyValue("--t3plus-bot-motion"), "");
  } finally {
    setBotArtEncoder(null);
  }
  // Without an animated PNG (SVG fallback) the keyframes step the sheet.
  const dom = createDom("/", "<span id='a'></span>");
  const el = dom.window.document.getElementById("a");
  applyAvatarVars(el, resolveBotPresentation({ key: "env1:b", status: "working" }, { color: "blue", shape: "circle" }));
  assert.equal(el.getAttribute("data-animated"), "");
});

test("the glow is rendered again only when something it draws changes", () => {
  const dom = createDom("/", "");
  const doc = dom.window.document;
  const timers = [];
  const win = { setTimeout: (fn, ms) => timers.push(ms), clearTimeout: () => {}, devicePixelRatio: 1, getComputedStyle: () => ({ color: "rgb(1, 2, 3)" }), performance: { now: () => 0 } };
  // A 2D context that reads back one red pixel, for the color probe.
  const probe = { clearRect() {}, fillRect() {}, getImageData: () => ({ data: [255, 0, 0, 255] }) };
  const fakeDoc = { documentElement: doc.documentElement, body: doc.body, createElement: (tag) => (tag === "canvas" ? { getContext: () => probe } : doc.createElement(tag)) };
  const renderer = createBackdropRenderer({ win, doc: fakeDoc });
  const host = doc.createElement("div");
  host.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0, left: 0 });
  const settings = defaultSettings();
  settings.composerGradient = { ...settings.composerGradient, accent: "#ff0000" };

  renderer.update({ mode: "half-circle", settings, imageSrc: null, host, cx: 0.5 });
  renderer.update({ mode: "half-circle", settings, imageSrc: "/assets/wallpaper.svg", host, cx: 0.5 });
  renderer.update({ mode: "half-circle", settings, imageSrc: "/assets/wallpaper.svg", host, cx: 0.3 });
  assert.equal(timers.length, 1, "the image and the glow's position are not part of the glow render");

  renderer.update({ mode: "half-circle", settings: { ...settings, composerGradient: { ...settings.composerGradient, intensity: 20 } }, imageSrc: null, host, cx: 0.5 });
  assert.equal(timers.length, 2, "a new intensity is");
  renderer.update({ mode: "image", settings, imageSrc: "/a.svg", host, cx: 0.5 });
  renderer.update({ mode: "image", settings, imageSrc: "/b.svg", host, cx: 0.5 });
  assert.equal(timers.length, 4, "the image mode renders each image");
});
