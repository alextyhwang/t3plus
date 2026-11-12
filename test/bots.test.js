import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_GRID, botArt, botEdgeColor, botFillUrl, defaultBotColor, ditherIndex, eyeCells, eyeOutline, skinMarks } from "../src/botArt.js";
import { bayerMatrix, DITHER_STYLES, ditherLevel, ditherRgbInPlace, glowPixelArt, glowStrength, glowTones, grainThreshold, GLOW_SHAPE } from "../src/ditherMath.js";
import { ditherGrid } from "../src/backdropRenderer.js";
import { botPreviewText, createBotFeed, parseBotFeedText, threadIdFromKey } from "../src/botFeed.js";
import {
  classifyBots,
  createBotStore,
  decorateBotRows,
  normalizeBotPrefs,
  parseBotTitle,
  parseRowStatus,
  resolveBotPresentation,
} from "../src/bots.js";
import { BOT_COLORS, BOT_SHAPES, BOT_SKINS, DEFAULT_BOT_MARKER, STORAGE_KEYS, T3PLUS } from "../src/config.js";
import { BOT_FEED_ENDPOINT } from "../src/hosts.js";
import { findSidebarInner, scanSidebar } from "../src/sidebar.js";
import {
  BOT_TITLE,
  createApp,
  createDom,
  createFakeChromeStorage,
  createFakeRemote,
  settle,
  sidebarHtml,
  T3_APPEARANCE_HTML,
  threadRowHtml,
} from "./helpers.js";

test("parseBotTitle matches the exact marker token only (first or last word)", () => {
  const M = DEFAULT_BOT_MARKER;
  assert.deepEqual(parseBotTitle(`${M} Orchestrator`), { label: "Orchestrator" });
  assert.deepEqual(parseBotTitle(`Release captain ${M}`), { label: "Release captain" });
  assert.deepEqual(parseBotTitle(M), { label: "" });
  assert.deepEqual(parseBotTitle(`  ${M}   Night   shift `), { label: "Night shift" });
  for (const title of [
    "Orchestrator",
    `x${M} Orchestrator`, // glued to another word
    `${M}x Orchestrator`,
    `Talk about ${M} markers`, // middle word: not a marker position
    `​${M} Orchestrator`, // zero-width prefix is not the marker
    `${M.toUpperCase()} Orchestrator`,
    "[[t3plus:bot:v2]] Orchestrator",
    "bot Orchestrator",
  ]) {
    assert.equal(parseBotTitle(title), null, JSON.stringify(title));
  }
  assert.deepEqual(parseBotTitle("[[acme:bot]] Ops", "[[acme:bot]]"), { label: "Ops" });
  assert.equal(parseBotTitle("bot Ops", "bot"), null, "an invalid marker never matches");
});

test("parseRowStatus reads T3's status label from the row's aria-label", () => {
  const t = "[[t3plus:bot:v1]] Ops, with a comma";
  assert.equal(parseRowStatus(`${t}, Working, Ops project`, t), "working");
  assert.equal(parseRowStatus(`${t}, Goal`, t), "working");
  assert.equal(parseRowStatus(`${t}, Approval, P`, t), "attention");
  assert.equal(parseRowStatus(`${t}, Failed`, t), "failed");
  assert.equal(parseRowStatus(`${t}, Done, P`, t), "done");
  assert.equal(parseRowStatus(`${t}, Waiting`, t), "waiting");
  assert.equal(parseRowStatus(`${t}, Ops project`, t), "idle");
  assert.equal(parseRowStatus("something else", t), "idle");
});

test("classifyBots: top-level rows only, with a child count from data-sidebar-parent", () => {
  const html = sidebarHtml().replace(
    "</ul>",
    `${threadRowHtml({ key: "env1:c1", title: "Subtask A", parent: "env1:bot1" })}
     ${threadRowHtml({ key: "env1:c2", title: "Subtask B", parent: "env1:bot1" })}
     ${threadRowHtml({ key: "env1:nested", title: `${DEFAULT_BOT_MARKER} Nested`, parent: "env1:bot1" })}
     ${threadRowHtml({ key: "env1:inf", title: `${DEFAULT_BOT_MARKER} In folder`, parent: "folder:github.com/acme/api" })}</ul>`,
  );
  const dom = createDom("/", html);
  const scan = scanSidebar(findSidebarInner(dom.window.document));
  const bots = classifyBots(scan, DEFAULT_BOT_MARKER);
  assert.deepEqual(bots.map((b) => b.key), ["env1:bot1", "env1:inf"]);
  assert.equal(bots[0].childCount, 3);
  assert.equal(bots[0].status, "working");
  assert.equal(bots[0].titleLabel, "Orchestrator");
});

test("bot prefs are a shape and a color from fixed lists; unknown values fall back safely", () => {
  assert.deepEqual(normalizeBotPrefs({ shape: "triangle", color: "orange" }), { shape: "triangle", color: "orange" });
  const odd = normalizeBotPrefs({ shape: "blob", color: "#ff0000", accent: "#ff0000", iconDataUrl: "javascript:alert(1)" }, "env1:bot1");
  assert.deepEqual(Object.keys(odd), ["shape", "color"], "no free-form color, icon or label fields");
  assert.equal(odd.shape, "circle");
  assert.ok(Object.hasOwn(BOT_COLORS, odd.color));
  assert.equal(odd.color, defaultBotColor("env1:bot1"), "default color is stable per bot");

  const view = resolveBotPresentation({ key: "env1:bot1", titleLabel: "Orchestrator" }, { shape: "star", color: "green" });
  assert.equal(view.label, "Orchestrator");
  assert.equal(view.clip, BOT_SHAPES.star);
  assert.equal(view.edge, BOT_COLORS.green.stops[1]);
  assert.match(view.fill, /^url\("data:image\/svg\+xml,/);
  assert.equal(resolveBotPresentation({ key: "k:1", titleLabel: "" }, {}).label, "Bot");
});

test("every color is a fixed three-stop ordered-dither gradient with white pixel eyes", () => {
  for (const [name, color] of Object.entries(BOT_COLORS)) {
    for (const shape of Object.keys(BOT_SHAPES).filter((s) => !Object.hasOwn(BOT_SKINS, s))) {
      const svg = decodeURIComponent(botFillUrl(name, shape).slice('url("data:image/svg+xml,'.length, -2));
      const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
      assert.deepEqual(fills, [...color.stops, "#ffffff"], `${name}/${shape}: three stops, then the eyes`);
      assert.match(svg, /shape-rendering="crispEdges"/);
    }
  }
  // Light at the top-left highlight, dark at the far corner, dithered in between.
  assert.equal(ditherIndex(5, 4), 0);
  assert.equal(ditherIndex(BOT_GRID - 1, BOT_GRID - 1), 2);
  const row = Array.from({ length: BOT_GRID }, (_, x) => ditherIndex(x, 12));
  assert.ok(new Set(row).size >= 2, "a middle row mixes stops");
  assert.equal(botFillUrl("blue", "star"), botFillUrl("blue", "star"), "cached");
  assert.equal(botFillUrl("nope", "nope"), botFillUrl("blue", "circle"));
});

test("ball shapes: football and basketball bring their own ramp and markings in every mood", () => {
  const svgOf = (art) => decodeURIComponent(art.url.slice('url("data:image/svg+xml,'.length, -2));
  const moods = ["awake", "idle", "waiting", "done", "failed", "working", "attention"];
  for (const shape of ["football", "basketball"]) {
    assert.ok(Object.hasOwn(BOT_SHAPES, shape) && Object.hasOwn(BOT_SKINS, shape), shape);
    const stops = BOT_SKINS[shape].stops;
    assert.equal(stops.length, 3);
    for (const mood of moods) {
      const art = botArt("blue", shape, mood);
      const fills = [...svgOf(art).matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
      assert.deepEqual(fills, [...stops, "#ffffff"], `${shape}/${mood}: own three stops, then white eyes and marks`);
      assert.equal(art.frames, botArt("blue", "circle", mood).frames, `${shape}/${mood}: same frame count`);
      assert.equal(art.duration, botArt("blue", "circle", mood).duration);
      assert.match(svgOf(art), new RegExp(`viewBox="0 0 ${24 * art.frames} 24"`));
      // The bot's color is ignored: every color gives the same ball.
      for (const color of Object.keys(BOT_COLORS)) assert.equal(botArt(color, shape, mood).url, art.url);
    }
    assert.equal(botEdgeColor("purple", shape), stops[1]);
    assert.equal(resolveBotPresentation({ key: "k:1", titleLabel: "Goat" }, { shape, color: "green" }).edge, stops[1]);
  }
  // Football laces are white, basketball seams are the dark stop.
  const laces = [...skinMarks("football").values()];
  assert.ok(laces.length >= 12 && laces.every((layer) => layer === 3), "white laces");
  const seams = [...skinMarks("basketball").values()];
  assert.ok(seams.length >= 40 && seams.every((layer) => layer === 2), "dark seams");
  // Laces never touch the eyes or their outline, in any frame of any mood.
  const glyphs = ["open", "closed", "lidded", "wide", "happy", "x"];
  for (const eyes of glyphs) {
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0]) {
        if (dx && dy) continue; // working moves sideways, attention hops: never both
        const cells = eyeCells("football", { eyes, dx, dy });
        const around = eyeOutline(cells);
        for (const lace of skinMarks("football").keys()) assert.ok(!cells.has(lace) && !around.has(lace), `${eyes} ${dx},${dy}: lace ${lace}`);
      }
    }
  }
  // Even hopping wide eyes stay below the laces.
  for (const cell of eyeCells("football", { eyes: "wide", dy: -1 })) assert.ok(Number(cell.split(",")[1]) >= 9);
});

test("eyes: two separate eyes per shape, inside the shape's clip, mirrored around its middle", () => {
  for (const shape of Object.keys(BOT_SHAPES)) {
    const cells = [...eyeCells(shape)].map((c) => c.split(",").map(Number));
    assert.ok(cells.length >= 12, shape);
    const xs = cells.map(([x]) => x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2; // the football's pair sits off-center, on its open side
    const left = xs.filter((x) => x < mid).length;
    assert.equal(left, cells.length - left, `${shape}: two equal eyes`);
    for (const [x, y] of cells) assert.ok(x >= 4 && x <= 19 && y >= 6 && y <= 19, `${shape}: eye cell ${x},${y} near the center`);
  }
  assert.notDeepEqual([...eyeCells("triangle")], [...eyeCells("circle")], "triangle eyes sit lower");
});

test("background dither: pixel-art glow made of a few far-apart tones, never a flat fill", () => {
  const m = bayerMatrix(16);
  assert.equal(new Set(m.flat()).size, 256, "every threshold used once");
  assert.equal(ditherLevel(0, 7, 0.5), 0);
  assert.equal(ditherLevel(1, 7, 0.5), 6);

  const width = 96;
  const height = 48;
  const rgb = [59, 130, 246];
  for (const style of DITHER_STYLES) {
    const px = glowPixelArt({ width, height, cx: 0.5, rgb, intensity: 0.55, style });
    const colors = new Set();
    for (let i = 0; i < px.length; i += 4) if (px[i + 3]) colors.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    assert.ok(colors.size >= 3 && colors.size <= 4, `${style}: only its few tones (${colors.size})`);
    // The tones are far apart in lightness: that is what keeps the pattern visible.
    const lum = [...colors].map((c) => c.split(",").map(Number)).map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
    assert.ok(Math.max(...lum) - Math.min(...lum) > 90, `${style}: tones far apart`);
    // Even the core keeps mixing two tones: no flat, smooth-looking area.
    const core = new Set();
    for (let y = 40; y < 48; y += 1) for (let x = 40; x < 56; x += 1) { const i = (y * width + x) * 4; core.add(`${px[i]},${px[i + 1]},${px[i + 2]},${px[i + 3]}`); }
    assert.ok(core.size >= 2, `${style}: the core is dithered, not flat`);
    assert.equal(px[3], 0, `${style}: top-left corner is clear`);
  }
  // Spectrum drifts in hue; bayer and grain keep one hue.
  const hueSpread = (style) => {
    const tones = glowTones(rgb, style).slice(1).map(([c]) => c);
    return Math.max(...tones.map((c) => c[1] - c[2])) - Math.min(...tones.map((c) => c[1] - c[2]));
  };
  assert.ok(hueSpread("spectrum") > hueSpread("bayer"));
  // Grain is not Bayer's grid: its thresholds do not repeat every 16 cells.
  let repeats = 0;
  for (let x = 0; x < 64; x += 1) repeats += grainThreshold(x, 3) === grainThreshold(x + 16, 3) ? 1 : 0;
  assert.ok(repeats < 4);

  const data = new Uint8ClampedArray([100, 150, 200, 255, 100, 150, 200, 255]);
  ditherRgbInPlace(data, 2, 1, 4);
  for (const v of data) assert.ok([0, 85, 170, 255].includes(v), `quantized ${v}`);

  // Cells are whole device pixels; huge panes get coarser cells instead of huge canvases.
  assert.deepEqual(ditherGrid(1500, 900, 1.5), { cell: 2, cols: 750, rows: 450 });
  const big = ditherGrid(3840, 2160, 2);
  assert.ok(big.cols * big.rows <= 1_200_000);
  assert.equal(Number.isInteger(big.cell * 2), true);
});

test("the glow stays near the composer: compact enough not to reach the top half or the far sides", () => {
  assert.ok(GLOW_SHAPE.haloRy < 0.5, "never reaches the middle of the pane");
  assert.equal(glowStrength(0.5, 0.45, 0.5, 1), 0, "nothing above ~55% height");
  assert.equal(glowStrength(0, 0.98, 0.5, 1), 0, "the far left edge is clear at the bottom");
  assert.ok(glowStrength(0.5, 0.97, 0.5, 0.55) > 0.4, "strong behind the composer");
});

test("bot store keeps shape/color per thread key and drops bad keys", async () => {
  const storage = createFakeChromeStorage();
  const store = createBotStore(storage.area, storage.onChanged);
  await store.update("env1:bot1", { shape: "hexagon" });
  await store.update("env1:bot1", { color: "pink" });
  assert.deepEqual((await store.load())["env1:bot1"], { shape: "hexagon", color: "pink" });
  storage.area.data.set(STORAGE_KEYS.bots, { "env1:bot1": { shape: "x", color: "teal", iconDataUrl: "data:text/html,<b>" }, "bad key": {} });
  assert.deepEqual(await store.load(), { "env1:bot1": { shape: "circle", color: "teal" } });
});

test("bot feed: parses t3plus-bots.json by thread id and builds the preview line", async () => {
  const text = JSON.stringify({
    version: 1,
    generatedAt: "2026-11-11T00:00:00Z",
    bots: {
      "thread:mcp:abc:1": { text: "  Ran   the nightly sync.\nAll green. ", role: "assistant", at: "2026-11-11T00:00:00Z" },
      bot1: { text: "check the deploy", role: "user" },
      "bad id": { text: "x" },
      empty: { text: "   " },
    },
  });
  const feed = parseBotFeedText(text);
  assert.deepEqual([...feed.entries.keys()], ["thread:mcp:abc:1", "bot1"]);
  assert.equal(threadIdFromKey("env-9:thread:mcp:abc:1"), "thread:mcp:abc:1", "thread ids may contain colons");
  assert.equal(botPreviewText(feed, "env-9:thread:mcp:abc:1"), "Ran the nightly sync. All green.");
  assert.equal(botPreviewText(feed, "env1:bot1"), "You: check the deploy");
  assert.equal(botPreviewText(feed, "env1:other"), "No messages yet");
  assert.equal(botPreviewText(null, "env1:bot1"), "", "no feed yet: no text rather than a wrong claim");
  for (const bad of ["", "nope", "{}", JSON.stringify({ version: 2, bots: {} })]) assert.equal(parseBotFeedText(bad), null);

  // Loads through the background fetcher, caches, and falls back to the cache.
  const storage = createFakeChromeStorage();
  const remote = createFakeRemote({ ok: true, status: 200, text });
  const loader = createBotFeed({ area: storage.area, fetchRemote: remote });
  assert.equal((await loader.load()).entries.size, 2);
  assert.deepEqual(remote.calls, [BOT_FEED_ENDPOINT]);
  remote.response = { ok: false, status: 0, error: "offline" };
  assert.equal((await loader.load()).entries.size, 2, "cached copy");
});

test("decorateBotRows lays out name, preview and avatar on T3's row in place; idempotent and reversible", () => {
  const dom = createDom("/", sidebarHtml());
  const doc = dom.window.document;
  const inner = findSidebarInner(doc);
  const scan = scanSidebar(inner);
  const bots = classifyBots(scan, DEFAULT_BOT_MARKER);
  const li = doc.querySelector('[data-thread-item="env1:bot1"]');
  const row = li.querySelector("[data-sidebar-row]");
  const before = { parent: li.parentElement, index: [...li.parentElement.children].indexOf(li), aria: row.getAttribute("aria-label") };
  const prefs = { "env1:bot1": { shape: "triangle", color: "red" } };
  const preview = (key) => (key === "env1:bot1" ? "Synced 3 repos." : "");

  decorateBotRows(doc, scan, bots, prefs, preview);
  assert.equal(row.getAttribute(T3PLUS.botAttr), "working");
  assert.equal(row.getAttribute("aria-description"), "t3+ bot: Orchestrator. Synced 3 repos.");
  const title = row.querySelector(`[${T3PLUS.botTitleAttr}]`);
  assert.equal(title.getAttribute(T3PLUS.botTitleAttr), "Synced 3 repos.");
  assert.equal(title.textContent, BOT_TITLE, "T3's title text is untouched");
  assert.equal(row.querySelector(".sr-only").textContent, BOT_TITLE);
  const avatar = row.querySelector(".t3plus-bot-avatar");
  assert.equal(avatar.parentElement, row);
  assert.equal(avatar.getAttribute("data-t3plus-shape"), "triangle");
  assert.equal(avatar.style.getPropertyValue("--t3plus-bot-clip"), BOT_SHAPES.triangle);
  assert.equal(avatar.style.getPropertyValue("--t3plus-bot-edge"), BOT_COLORS.red.stops[1]);
  assert.equal(avatar.getAttribute("data-status"), "working");
  // Not moved, not re-parented, aria-label untouched.
  assert.equal(li.parentElement, before.parent);
  assert.equal([...li.parentElement.children].indexOf(li), before.index);
  assert.equal(row.getAttribute("aria-label"), before.aria);

  // Second run adds nothing.
  decorateBotRows(doc, scanSidebar(inner), bots, prefs, preview);
  assert.equal(row.querySelectorAll(`[${T3PLUS.ownedAttr}]`).length, 1);

  // The title loses its marker (renamed in T3): decoration is removed.
  row.querySelector(".sr-only").textContent = "Orchestrator";
  title.textContent = "Orchestrator";
  const rescanned = scanSidebar(inner);
  decorateBotRows(doc, rescanned, classifyBots(rescanned, DEFAULT_BOT_MARKER), {});
  assert.equal(row.hasAttribute(T3PLUS.botAttr), false);
  assert.equal(row.hasAttribute("aria-description"), false);
  assert.equal(row.querySelectorAll(`[${T3PLUS.ownedAttr}], [${T3PLUS.botTitleAttr}]`).length, 0);
  assert.equal(row.getAttribute("style"), null);
});

test("app: bot rows show the feed preview, and Settings edits shape and color", async () => {
  const storage = createFakeChromeStorage();
  const feedText = JSON.stringify({ version: 1, bots: { bot1: { text: "Nightly run done.", role: "assistant" } } });
  const botFeed = createBotFeed({ area: storage.area, fetchRemote: createFakeRemote({ ok: true, status: 200, text: feedText }) });
  const sidebar = createDom("/env1/a1", sidebarHtml({ currentKey: "env1:a1" }));
  const sdoc = sidebar.window.document;
  const sideApp = createApp(sidebar, storage, { remote: createFakeRemote({ ok: false, status: 404 }), botFeed }).app;
  await sideApp.start();
  await settle();
  sideApp.watcher.flush();

  const row = sdoc.querySelector('[data-sidebar-row="env1:bot1"]');
  assert.equal(row.getAttribute(T3PLUS.botAttr), "working");
  assert.equal(row.querySelector(`[${T3PLUS.botTitleAttr}]`).getAttribute(T3PLUS.botTitleAttr), "Nightly run done.");
  assert.equal(sdoc.querySelectorAll('[data-sidebar-row="env1:bot1"]').length, 1);
  const plain = sdoc.querySelector('[data-sidebar-row="env1:a1"]');
  assert.equal(plain.hasAttribute(T3PLUS.botAttr), false);
  assert.equal(plain.querySelectorAll(`[${T3PLUS.ownedAttr}]`).length, 0);
  assert.equal(storage.area.data.get(STORAGE_KEYS.knownBots)["env1:bot1"].title, BOT_TITLE);

  // Settings tab lists the known bot with shape and color pickers, and nothing else to edit.
  const settings = createDom("/settings/appearance", T3_APPEARANCE_HTML);
  const settingsApp = createApp(settings, storage, { remote: createFakeRemote({ ok: false, status: 404 }), botFeed }).app;
  await settingsApp.start();
  await settle();
  const editor = settings.window.document.querySelector('.t3plus-bot-editor[data-bot-key="env1:bot1"]');
  assert.ok(editor);
  assert.equal(editor.querySelectorAll("input, select").length, 0, "no free text, color picker or upload");
  const shapeButtons = editor.querySelectorAll('[aria-label="Shape for env1:bot1"] button');
  const colorButtons = editor.querySelectorAll('[aria-label="Color for env1:bot1"] button');
  assert.equal(shapeButtons.length, Object.keys(BOT_SHAPES).length);
  assert.equal(colorButtons.length, Object.keys(BOT_COLORS).length);
  assert.equal(editor.querySelector(".t3plus-bot-preview").textContent, "Nightly run done.");

  editor.querySelector('[aria-label="Shape for env1:bot1"] button[data-value="diamond"]').click();
  await settle();
  editor.querySelector('[aria-label="Color for env1:bot1"] button[data-value="purple"]').click();
  await settle();
  await settle();
  assert.deepEqual(storage.area.data.get(STORAGE_KEYS.bots)["env1:bot1"], { shape: "diamond", color: "purple" });
  assert.equal(editor.querySelector('button[data-value="diamond"]').getAttribute("aria-pressed"), "true");
  assert.equal(editor.querySelector('button[data-value="purple"]').getAttribute("aria-pressed"), "true");

  // The sidebar tab picks the change up live.
  sideApp.watcher.flush();
  const avatar = row.querySelector(".t3plus-bot-avatar");
  assert.equal(avatar.getAttribute("data-t3plus-shape"), "diamond");
  assert.equal(avatar.style.getPropertyValue("--t3plus-bot-edge"), BOT_COLORS.purple.stops[1]);

  // A ball shape brings its own colors: the Color picker hides, the saved color stays.
  const colorField = editor.querySelector('[aria-label="Color for env1:bot1"]').parentElement;
  assert.equal(colorField.style.display, "");
  editor.querySelector('[aria-label="Shape for env1:bot1"] button[data-value="football"]').click();
  await settle();
  await settle();
  assert.deepEqual(storage.area.data.get(STORAGE_KEYS.bots)["env1:bot1"], { shape: "football", color: "purple" });
  assert.equal(colorField.style.display, "none");
  sideApp.watcher.flush();
  assert.equal(avatar.style.getPropertyValue("--t3plus-bot-edge"), BOT_SKINS.football.stops[1]);

  await settingsApp.actions.forgetBot("env1:bot1");
  assert.equal(storage.area.data.get(STORAGE_KEYS.bots)["env1:bot1"], undefined);
  for (const app of [sideApp, settingsApp]) app.stop();
});

test("bots feature off removes every bot decoration", async () => {
  const dom = createDom("/", sidebarHtml());
  const doc = dom.window.document;
  const { app } = createApp(dom);
  await app.start();
  app.watcher.flush();
  assert.ok(doc.querySelector(`[${T3PLUS.botAttr}]`));
  await app.actions.setSidebarFeature("bots", false);
  app.watcher.flush();
  assert.equal(doc.querySelectorAll(`[${T3PLUS.botAttr}], [${T3PLUS.ownedAttr}], [${T3PLUS.botTitleAttr}]`).length, 0);
  app.stop();
});

test("bot moods: closed eyes when idle, animated sprites when working or needing you", async () => {
  const { botArt, MOOD_BY_STATUS } = await import("../src/botArt.js");
  const idle = botArt("blue", "circle", MOOD_BY_STATUS.idle);
  const working = botArt("blue", "circle", MOOD_BY_STATUS.working);
  const attention = botArt("blue", "circle", MOOD_BY_STATUS.attention);
  assert.equal(idle.frames, 1);
  assert.equal(idle.duration, 0);
  assert.ok(working.frames >= 6 && working.duration > 0, "working animates");
  assert.ok(attention.frames >= 6 && attention.duration > 0, "needs-you animates");
  const svgWidth = (art) => Number(decodeURIComponent(art.url).match(/viewBox="0 0 (\d+) 24"/)[1]);
  assert.equal(svgWidth(working), 24 * working.frames, "one 24x24 frame per step, side by side");
  // Eyes differ per mood: idle is a single closed line, attention is taller than open.
  const rows = (cells) => new Set([...cells].map((c) => c.split(",")[1])).size;
  assert.equal(rows(eyeCells("circle", { eyes: "closed" })), 1);
  assert.ok(rows(eyeCells("circle", { eyes: "wide" })) > rows(eyeCells("circle", { eyes: "open" })));
  assert.notDeepEqual([...eyeCells("circle", { eyes: "x" })], [...eyeCells("circle", { eyes: "happy" })]);
  // Unknown status -> the neutral face; the row decoration marks animated avatars.
  const view = resolveBotPresentation({ key: "env1:bot1", titleLabel: "Ops", status: "working" }, { color: "red" });
  assert.equal(view.mood, "working");
  assert.equal(view.frames, working.frames === botArt("red", "circle", "working").frames ? view.frames : -1);
  assert.equal(resolveBotPresentation({ key: "k:1", titleLabel: "x" }, {}).mood, "awake");
});

test("decorated bot rows: animated avatar while working, static closed eyes when idle, two lines only", () => {
  // T3's card row: the body (relative z-10) holds the top, title and branch lines.
  const card = `<li data-thread-item="env1:bot1"><div role="button" data-sidebar-row="env1:bot1" aria-label="${BOT_TITLE}, Working, ops">
    <span class="sr-only">${BOT_TITLE}</span>
    <div class="relative z-10"><div class="flex"><span>ops</span><span class="group/sidebar-status-slot">4m</span></div>
      <div class="flex"><span aria-hidden="true">${BOT_TITLE}</span></div><div class="flex"><span>main</span></div></div></div></li>`;
  const dom = createDom("/", sidebarHtml().replace("</ul>", `${card}</ul>`).replace(/<li data-thread-item="env1:bot1"[\s\S]*?<\/li>/, ""));
  const doc = dom.window.document;
  const inner = findSidebarInner(doc);
  const scan = scanSidebar(inner);
  const bots = classifyBots(scan, DEFAULT_BOT_MARKER);
  const branchLine = doc.querySelector('[data-sidebar-row="env1:bot1"] .relative.z-10').children[2];
  branchLine.insertAdjacentHTML("afterend", '<div class="t3plus-bot-metaline" data-t3plus-owned>v0.5 line</div>');
  decorateBotRows(doc, scan, bots, {}, () => "Ran.");
  const row = doc.querySelector('[data-sidebar-row="env1:bot1"]');
  const avatar = row.querySelector(".t3plus-bot-avatar");
  assert.equal(avatar.getAttribute("data-t3plus-mood"), "working");
  assert.ok(avatar.hasAttribute("data-animated"));
  assert.ok(Number(avatar.style.getPropertyValue("--t3plus-bot-frames")) > 1);
  assert.equal(row.querySelector(".t3plus-bot-metaline"), null, "no model/computer line (and a v0.5 one is removed)");
  assert.ok(branchLine.hasAttribute("data-t3plus-bot-hide"), "T3's branch line is hidden");
  assert.equal(row.querySelector(`[${T3PLUS.botTitleAttr}]`).getAttribute(T3PLUS.botTitleAttr), "Ran.");

  decorateBotRows(doc, scan, [{ ...bots[0], status: "idle" }], {}, () => "Ran.");
  assert.equal(avatar.getAttribute("data-t3plus-mood"), "idle");
  assert.equal(avatar.hasAttribute("data-animated"), false);
  assert.equal(avatar.style.getPropertyValue("--t3plus-bot-frames"), "");
});

test("bot feed carries model and computer (shown in Settings)", async () => {
  const { botMetaText } = await import("../src/botFeed.js");
  const feed = parseBotFeedText(JSON.stringify({ version: 1, bots: { b1: { text: "", model: "GPT-6.1 Sol", computer: "Studio" }, b2: { text: "hi" } } }));
  assert.equal(botMetaText(feed, "env:b1"), "GPT-6.1 Sol · Studio");
  assert.equal(botPreviewText(feed, "env:b1"), "No messages yet");
  assert.equal(botMetaText(feed, "env:b2"), "");
  assert.equal(botMetaText(null, "env:b1"), "");
});

test("background dither cells are the same CSS size on every screen", () => {
  assert.equal(ditherGrid(1000, 800, 2).cell, 2, "2x Retina (default Medium): 4 device px per cell");
  assert.equal(ditherGrid(1000, 800, 2, 4 / 3).cell, 1.5, "Fine on Retina: about one bot-avatar pixel");
  assert.equal(ditherGrid(1000, 800, 3, 3).cell, 3);
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    const { cell } = ditherGrid(1000, 800, dpr);
    assert.ok(Math.abs(cell * dpr - Math.round(cell * dpr)) < 1e-9, `whole device pixels at ${dpr}x`);
    assert.ok(cell >= 1.5, `visible at ${dpr}x`);
  }
});

test("the three styles are all pixel variants: bayer, grain, spectrum", async () => {
  const { DITHER_STYLES: fromRenderer } = await import("../src/backdropRenderer.js");
  assert.deepEqual([...fromRenderer], ["bayer", "grain", "spectrum"]);
  const a = glowPixelArt({ width: 64, height: 32, cx: 0.5, rgb: [59, 130, 246], intensity: 0.6, style: "bayer" });
  const b = glowPixelArt({ width: 64, height: 32, cx: 0.5, rgb: [59, 130, 246], intensity: 0.6, style: "grain" });
  let diff = 0;
  for (let i = 3; i < a.length; i += 4) diff += a[i] !== b[i] ? 1 : 0;
  assert.ok(diff > 50, "grain scatters pixels differently from bayer");
});

test("T3's thread hover card shows the bot's face and clean name instead of the raw marker title", async () => {
  const dom = createDom("/", sidebarHtml());
  const doc = dom.window.document;
  const { app } = createApp(dom);
  try {
    await app.start();
    app.watcher.flush();
    // ThreadHoverCard.tsx inside T3's tooltip popup, portaled to <body>.
    doc.body.insertAdjacentHTML("beforeend", `<div data-slot="tooltip-positioner"><div data-slot="tooltip-popup"><div data-slot="tooltip-viewport">
      <div class="flex flex-col"><div class="min-w-0 truncate text-xs leading-tight font-medium text-foreground">${BOT_TITLE}</div><div class="grid">Save draft</div></div></div></div></div>`);
    await new Promise((r) => setTimeout(r, 0)); // the popup observer runs in a microtask, before paint
    const title = doc.querySelector('[data-slot="tooltip-popup"] .truncate');
    assert.ok(title.hasAttribute("data-t3plus-bot-hover"));
    assert.equal(title.getAttribute("data-t3plus-bot-hover-label"), "Orchestrator");
    assert.match(title.style.getPropertyValue("--t3plus-bot-fill"), /^url\("data:image\/svg\+xml,/);
    assert.equal(title.textContent, BOT_TITLE, "T3's text is untouched (hidden by CSS)");

    // T3 reuses the card for an ordinary thread: the decoration goes away.
    title.textContent = "Fix login redirect";
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(title.hasAttribute("data-t3plus-bot-hover"), false);
  } finally {
    app.stop();
  }
});

test("idle bots keep their eyes open", async () => {
  const { botArt } = await import("../src/botArt.js");
  assert.equal(botArt("blue", "circle", "idle").url === botArt("blue", "circle", "awake").url, false, "idle is dimmer than awake");
  const svg = decodeURIComponent(botArt("blue", "circle", "idle").url);
  const awake = decodeURIComponent(botArt("blue", "circle", "awake").url);
  const eyes = (s) => s.match(/fill="#ffffff" d="([^"]*)"/)[1];
  assert.equal(eyes(svg), eyes(awake), "same open eyes as the neutral face");
});

test("bot faces use a registered pixel encoder (PNG in the browser) and fall back to SVG", async () => {
  const { botArt, setBotArtEncoder } = await import("../src/botArt.js");
  const calls = [];
  setBotArtEncoder((pixels, width, height, fills) => {
    calls.push({ width, height, fills, max: Math.max(...pixels) });
    return "data:image/png;base64,AAAA";
  });
  try {
    const art = botArt("blue", "circle", "working");
    assert.equal(art.url, 'url("data:image/png;base64,AAAA")');
    assert.equal(calls[0].width, 24 * art.frames);
    assert.equal(calls[0].height, 24);
    assert.equal(calls[0].fills.length, 4);
    assert.ok(calls[0].max <= 3, "palette indices");
  } finally {
    setBotArtEncoder(null);
  }
  assert.match(botArt("blue", "circle", "working").url, /^url\("data:image\/svg\+xml,/);
});
