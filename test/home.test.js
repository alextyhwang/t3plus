import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityStats,
  dailyActivity,
  dayKey,
  formatTokens,
  heatmap,
  parseHomeFeedText,
  poolModel,
  profileProjectSet,
  projectPool,
  tokenSeries,
} from "../src/homeData.js";
import { T3PLUS } from "../src/config.js";
import { createTooltip } from "../src/homeTooltip.js";
import { HEAT_WEEKS } from "../src/homeWidgets.js";
import { createApp, createDom, createFakeChromeStorage, createFakeRemote } from "./helpers.js";

const NOW = new Date(2026, 10, 12, 1, 0, 0); // Thu Nov 12 2026, local
const FEED = {
  version: 1,
  generatedAt: "2026-11-12T06:00:00Z",
  projects: [
    { title: "billing", root: "C:\\Users\\me\\projects\\billing" },
    { title: "notes", root: "C:\\Users\\me\\projects\\notes" },
  ],
  activity: {
    "2026-11-10": [[0, 2, 30], [1, 1, 5]],
    "2026-11-11": [[0, 1, 4]],
    "2026-11-12": [[1, 3, 12]],
    "2026-10-05": [[0, 4, 20]],
    "2026-10-11": [[0, 1, 1]],
  },
  spend: {
    "2026-11-11": { codex: [3, 1000], claude: [7, 2000] },
    "2026-10-10": { codex: [1, 10] },
  },
  limits: {
    claude: [{ id: "claudeAgent", label: "Claude", windows: [
      { label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 85, resetsAt: "2026-11-14T10:00:00Z" },
      { label: "Session", kind: "session", durationMins: 300, usedPercent: 13, resetsAt: "2026-11-12T08:40:00Z" },
      { label: "Monthly spend", kind: "monthly", durationMins: null, usedPercent: 39 },
      { label: "Bad", usedPercent: "x" },
    ] }],
    codex: { accounts: [
      { label: "Team", plan: "ChatGPT Pro 100 Subscription", windows: [{ label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 50, resetsAt: "2026-11-15T00:00:00Z" }] },
      { label: "Personal", plan: "ChatGPT Plus Subscription", windows: [
        { label: "Session", kind: "session", durationMins: 300, usedPercent: 40 },
        { label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 100, resetsAt: "2026-11-13T00:00:00Z" },
      ] },
      { label: "School", plan: "ChatGPT Plus Subscription", windows: [{ label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 0 }] },
    ] },
  },
  // Codex pool every 30 minutes over the last day, falling 10 points an hour: 840 -> 600.
  codexSeries: Array.from({ length: 49 }, (_, i) => [Date.UTC(2026, 10, 11, 6) / 1000 + i * 1800, 840 - i * 5, 1200]).concat([["bad"]]),
  claudeSeries: [[Date.UTC(2026, 10, 12, 5) / 1000, 115, 200]],
};
const feed = () => parseHomeFeedText(JSON.stringify(FEED));
const notesOnly = { id: "notes", includeAll: false, projects: ["C:\\Users\\me\\projects\\notes"], excludeProjects: [], threads: [] };
const allButNotes = { id: "work", includeAll: true, projects: [], excludeProjects: ["C:\\Users\\me\\projects\\notes"], threads: [] };

test("home feed parses, validates and drops bad entries", () => {
  const f = feed();
  assert.equal(f.projects.length, 2);
  assert.equal(f.claude[0].windows.length, 3, "malformed window dropped");
  for (const bad of ["", "nope", "{}", JSON.stringify({ version: 2 })]) assert.equal(parseHomeFeedText(bad), null);
});

test("activity follows the active profile and fills a 26-week heatmap ending today", () => {
  const f = feed();
  const all = dailyActivity(f, profileProjectSet(f, null));
  assert.deepEqual(all.get("2026-11-10"), { threads: 3, runs: 35 });
  const sh = dailyActivity(f, profileProjectSet(f, notesOnly));
  assert.deepEqual([...sh.keys()].sort(), ["2026-11-10", "2026-11-12"], "only notes");
  const al = dailyActivity(f, profileProjectSet(f, allButNotes));
  assert.equal(al.has("2026-11-12"), false, "notes excluded from work");

  const map = heatmap(all, NOW, 26);
  assert.equal(map.columns.length, 26);
  assert.ok(map.columns.every((c) => c.length === 7));
  const cells = map.columns.flat();
  const today = cells.find((c) => c.today);
  assert.equal(today.key, dayKey(NOW));
  assert.ok(today.level > 0);
  assert.ok(cells.filter((c) => c.future).every((c) => c.level === 0), "no levels in the future");
  assert.equal(map.threads, 12);
  assert.equal(map.runs, 72);
  assert.equal(Math.max(...cells.map((c) => c.level)), 4);
});

test("Codex pool: Plus weeks (Pro = 10x), recorded line, projection at the recorded pace with weekly refills", () => {
  const f = feed();
  assert.equal(f.codexSeries.length, 49, "malformed point dropped");
  const now = Date.UTC(2026, 10, 12, 6);
  const pool = poolModel(f, "codex", now);
  assert.equal(pool.cap, 1200);
  assert.equal(pool.left, 500 + 0 + 100);
  const { burn } = projectPool({ recorded: f.codexSeries, left: pool.left, cap: pool.cap, refills: [], now, until: now + 3600000 });
  assert.ok(Math.abs(burn - 10) < 0.01, "10 points an hour, from the last day of the recorded line");
  assert.equal(pool.recorded.at(-1).left, 600, "the line ends at the live value");
  assert.deepEqual(pool.nextRefill, { at: Date.UTC(2026, 10, 13), amount: 100 }, "Personal's week comes back first");
  // Projection: 600 falling 10/h; Personal +100 lands at 18h, Team +500 at 66h, just before it would run out.
  const at = (h) => pool.projected.find((p) => p.t === now + h * 3600000).left;
  assert.equal(at(17.5), 425);
  assert.equal(at(18), 520, "refill lands");
  assert.equal(at(65.5), 45);
  assert.equal(at(66), 540, "Team's week comes back first");
  assert.equal(pool.runsOutAt, null, "lasts the 3-day window");
  const tight = poolModel({ ...f, codexSeries: f.codexSeries.map((p) => ({ ...p, left: p.left * 3 })) }, "codex", now);
  assert.equal(tight.runsOutAt, now + 23.5 * 3600000, "30/h: 60 left at 18h, +100, out by 23.5h");
  assert.ok(pool.projected.every((p) => p.left >= 0 && p.left <= pool.cap));
  assert.equal(projectPool({ recorded: [], left: 50, cap: 100, refills: [], now, until: now + 86400000 }).runsOutAt, null, "no history: flat");
});

test("Claude pool adds up each account's weekly window (100% each)", () => {
  const pool = poolModel(feed(), "claude", Date.UTC(2026, 10, 12, 6));
  assert.equal(pool.cap, 100);
  assert.equal(pool.left, 15);
  assert.equal(poolModel(parseHomeFeedText(JSON.stringify({ ...FEED, limits: { claude: [], codex: null } })), "claude"), null);
});

test("activity numbers and the token series", () => {
  const f = feed();
  const stats = activityStats(dailyActivity(f, profileProjectSet(f, null)), NOW);
  assert.deepEqual(stats, { week: 51, streak: 3, best: 35 });
  const t = tokenSeries(f, NOW, 14);
  assert.equal(t.days.length, 14);
  assert.equal(t.days.at(-1), dayKey(NOW));
  assert.deepEqual(t.series.map((x) => x.provider), ["codex", "claude"]);
  assert.equal(t.series[1].values.at(-2), 2000);
  assert.deepEqual(t.month.claude, { cost: 7, tokens: 2000 });
  assert.equal(formatTokens(27836752), "28M");
  assert.equal(formatTokens(1500000000), "1.5B");
});

test("usage keeps a provider in the historical legend after its last usage leaves the window", () => {
  const f = feed();
  f.spend.set("2026-09-01", { claude_removed: [12, 9000] });
  const t = tokenSeries(f, NOW, 14);
  assert.deepEqual(t.series.map((x) => x.provider), ["codex", "claude", "claude_removed"]);
  assert.deepEqual(t.series.at(-1).values, Array(14).fill(0));
});

// T3's draft hero (ChatView.tsx @ da36859c): the overlay fills the pane (inset-0, a flex
// column) and the composer stack holds the composer; the headline hangs above it.
const HERO_CLASS = "pointer-events-none absolute inset-0 z-20 flex flex-col before:basis-[max(0px,calc(50%-5rem))] *:shrink-0";
const OLD_HERO_CLASS = "pointer-events-none absolute inset-0 z-20 flex items-center";
const DOCKED_CLASS = "pointer-events-none absolute inset-x-0 bottom-0 z-20";
const HERO = `
  <div data-slot="sidebar-inner"><ul>
    <li data-thread-item="env1:a1"><div role="button" data-sidebar-row="env1:a1" aria-label="Fix login, billing"><span class="sr-only">Fix login</span>
      <div class="relative z-10"><div><span>billing</span><span class="group/sidebar-status-slot"><span>5h</span><button type="button">Settle</button></span></div><div><span aria-hidden="true">Fix login</span></div></div></div></li>
  </ul></div>
  <main><div data-workspace-area="conversation"><div class="h-full min-h-0 bg-background"></div></div>
    <div data-chat-composer-overlay="true" class="${HERO_CLASS}">
      <div class="chat-composer-lane w-full"><div data-chat-composer-stack="true" class="relative">
        <div class="absolute inset-x-0 bottom-full"><h1>What should we build?</h1></div>
        <div class="relative z-10"><div data-chat-composer-surface="true"><div data-chat-composer-body="true"><div data-testid="composer-editor"></div></div></div></div>
      </div></div>
    </div></main>`;

test("app: four compact cards mount under the hero composer (and only there) and follow settings", async () => {
  const storage = createFakeChromeStorage();
  const remote = createFakeRemote({ ok: true, status: 200, text: JSON.stringify(FEED) });
  const homeFeed = (await import("../src/homeData.js")).createHomeFeed({ area: storage.area, fetchRemote: remote });
  const dom = createDom("/draft/abc", HERO);
  const doc = dom.window.document;
  const { app } = createApp(dom, storage, { homeFeed });
  try {
    await app.start();
    await new Promise((r) => setTimeout(r, 0));
    app.watcher.flush();

    const home = doc.getElementById(T3PLUS.homeId);
    assert.ok(home, "mounted");
    assert.equal(home.parentElement, doc.querySelector('[data-chat-composer-stack="true"]'), "inside T3's composer stack");
    assert.ok(doc.documentElement.hasAttribute(T3PLUS.homeAttr));
    assert.deepEqual([...home.querySelectorAll(".t3plus-w-head h3")].map((e) => e.textContent), ["Codex pool", "Claude pool", "Activity", "Usage"]);
    assert.equal(home.querySelectorAll(".t3plus-w-cell").length, HEAT_WEEKS * 7);
    assert.match(home.querySelector(".t3plus-w-codex .t3plus-w-big-num").textContent, /%$/);
    assert.ok(home.querySelector(".t3plus-w-codex .t3plus-w-line-projected"), "dashed projection");
    assert.ok(home.querySelector(".t3plus-w-codex .t3plus-w-now"), "now marker");
    assert.ok(home.querySelectorAll(".t3plus-w-usage path[stroke]").length >= 2, "one line per provider");
    assert.equal(home.querySelectorAll("button").length, 0, "nothing duplicates the sidebar");

    await app.actions.setHomeWidgets(false);
    app.watcher.flush();
    assert.equal(doc.getElementById(T3PLUS.homeId), null);
    assert.equal(doc.documentElement.hasAttribute(T3PLUS.homeAttr), false);
  } finally {
    app.stop();
  }
});

test("app: no widgets in a normal thread (composer docked at the bottom)", async () => {
  const dom = createDom("/env1/a1", HERO.replace(HERO_CLASS, DOCKED_CLASS));
  const { app } = createApp(dom, undefined, { homeFeed: { readCache: async () => null, load: async () => null } });
  await app.start();
  app.watcher.flush();
  assert.equal(dom.window.document.getElementById(T3PLUS.homeId), null);
  app.stop();
});

test("app: the widgets also mount on older T3's centered hero (items-center)", async () => {
  const dom = createDom("/draft/abc", HERO.replace(HERO_CLASS, OLD_HERO_CLASS));
  const { app } = createApp(dom, undefined, { homeFeed: { readCache: async () => null, load: async () => null } });
  try {
    await app.start();
    app.watcher.flush();
    assert.ok(dom.window.document.getElementById(T3PLUS.homeId));
  } finally {
    app.stop();
  }
});

test("app: the widgets are as wide as the composer, but never wider than the room on its narrower side of the pane", async () => {
  const dom = createDom("/draft/abc", HERO);
  const doc = dom.window.document;
  const rect = (left, width) => () => ({ left, width, top: 0, height: 100, right: left + width, bottom: 100 });
  doc.querySelector('[data-workspace-area="conversation"]').getBoundingClientRect = rect(0, 1000);
  const stack = doc.querySelector('[data-chat-composer-stack="true"]');
  const { app } = createApp(dom, undefined, { homeFeed: { readCache: async () => null, load: async () => null } });
  const width = () => doc.documentElement.style.getPropertyValue("--t3plus-home-width");
  try {
    stack.getBoundingClientRect = rect(200, 600); // centered in the pane
    await app.start();
    app.watcher.flush();
    assert.ok(doc.getElementById(T3PLUS.homeId), "mounted");
    assert.equal(width(), "600px", "the composer's width");
    stack.getBoundingClientRect = rect(600, 600); // pushed right: 100px to the pane's right edge
    app.watcher.flush();
    assert.equal(width(), "152px", "twice the room on the right, less the margins");
    stack.getBoundingClientRect = rect(950, 600); // center outside the pane
    app.watcher.flush();
    assert.equal(width(), "0px", "never negative");
  } finally {
    app.stop();
    dom.window.close();
  }
});

test("Claude pool weights plans: Max ($100) is 5x Pro ($20), so Pro + Max = 600%", () => {
  const withPlans = JSON.parse(JSON.stringify(FEED));
  withPlans.limits.claude = [
    { id: "claudeAgent", label: "Claude", plan: "Claude Pro", windows: [{ label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 85, resetsAt: "2026-11-14T10:00:00Z" }] },
    { id: "claude_xello2", label: "Xello2", plan: "Claude Max", windows: [{ label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 40, resetsAt: "2026-11-17T11:00:00Z" }] },
  ];
  const pool = poolModel(parseHomeFeedText(JSON.stringify(withPlans)), "claude", Date.UTC(2026, 10, 12, 6));
  assert.equal(pool.cap, 600);
  assert.equal(pool.left, 15 + 300);
  assert.deepEqual(pool.refills.map((r) => r.amount), [85], "only refills inside the 3-day window are drawn");
  const week = poolModel(parseHomeFeedText(JSON.stringify(withPlans)), "claude", Date.UTC(2026, 10, 12, 6), { ahead: 7 });
  assert.deepEqual(week.refills.map((r) => r.amount), [85, 200], "a Max refill brings back 5x as much");
});

test("Activity uses the activity source's tokens per day when the feed has them", async () => {
  const { tokenDaily } = await import("../src/homeData.js");
  const f = parseHomeFeedText(JSON.stringify({ ...FEED, aiActivity: { "2026-11-11": [1018102370, { codex: 416198814, claude: 601903556, cursor: 0 }], "2026-11-10": [0, {}], "2026-11-08": [7, {}], "2026-11-07": 7, bad: [5, {}], "2026-11-09": ["x", {}] } }));
  assert.deepEqual([...f.aiActivity.keys()], ["2026-11-11", "2026-11-10", "2026-11-08"]);
  assert.deepEqual(f.aiActivity.get("2026-11-11").providers, { codex: 416198814, claude: 601903556 }, "zero providers dropped");
  assert.deepEqual([...tokenDaily(f)], [
    ["2026-11-11", { threads: 0, runs: 1018102370, providers: { codex: 416198814, claude: 601903556 } }],
    ["2026-11-08", { threads: 0, runs: 7, providers: {} }],
  ], "zero days and malformed entries dropped");
});

test("hover: a T3-style tooltip for heatmap days and chart points, a crosshair, and clean removal", async () => {
  const storage = createFakeChromeStorage();
  const feedJson = { ...FEED, aiActivity: { [dayKey(new Date())]: [900, { codex: 600, claude: 300 }] } };
  const remote = createFakeRemote({ ok: true, status: 200, text: JSON.stringify(feedJson) });
  const homeFeed = (await import("../src/homeData.js")).createHomeFeed({ area: storage.area, fetchRemote: remote });
  const dom = createDom("/draft/abc", HERO);
  const doc = dom.window.document;
  const { app } = createApp(dom, storage, { homeFeed });
  const move = (el) => el.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }));
  try {
    await app.start();
    await new Promise((r) => setTimeout(r, 0));
    app.watcher.flush();
    const home = doc.getElementById(T3PLUS.homeId);
    assert.equal(home.querySelectorAll(".t3plus-w-cell[title]").length, 0, "no native title tooltips");

    move(home.querySelector(".t3plus-w-cell[data-today]"));
    const tip = doc.getElementById("t3plus-tip");
    assert.ok(tip && tip.parentElement === doc.body, "one tooltip on <body>");
    assert.ok(tip.hasAttribute("data-open"));
    assert.equal(tip.getAttribute("aria-hidden"), "true");
    assert.deepEqual([...tip.querySelectorAll(".t3plus-tip-row")].map((r) => r.textContent), ["Codex600", "Claude300", "Total900"]);

    move(home.querySelector(".t3plus-w-usage .t3plus-w-plot svg"));
    assert.match(tip.querySelector(".t3plus-tip-total").textContent, /^Total/);
    const marker = home.querySelector(".t3plus-w-usage .t3plus-w-hover");
    assert.ok(marker.hasAttribute("data-on"), "crosshair shown");
    assert.ok(marker.querySelectorAll(".t3plus-w-hover-dot").length >= 2, "a dot per provider");

    move(home.querySelector(".t3plus-w-codex .t3plus-w-plot svg"));
    assert.match(tip.querySelector(".t3plus-tip-row").textContent, /^Left/);
    assert.equal(marker.hasAttribute("data-on"), false, "only one crosshair at a time");

    home.dispatchEvent(new dom.window.MouseEvent("pointerleave"));
    assert.equal(tip.hasAttribute("data-open"), false, "fades out on leave");
  } finally {
    app.stop();
  }
  assert.equal(doc.getElementById("t3plus-tip"), null, "removed when t3+ stops");
});

test("tooltip skips null rows instead of exposing a literal null", () => {
  const dom = createDom("/draft/abc", "");
  const tip = createTooltip(dom.window.document);
  tip.show(
    { x: 40, top: 80, bottom: 100 },
    { label: "2:17 PM", rows: [{ name: "Left", value: "293% of 600" }, { name: null, value: null }, { name: "null", value: "null" }] },
  );
  assert.equal(dom.window.document.getElementById("t3plus-tip").textContent, "2:17 PMLeft293% of 600");
});

test("the glow position changes instantly and the watcher skips its throttle right after a navigation", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/styles/content.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /--t3plus-glow-[xy]\s+\d+(?:ms|s)/, "no position tween during navigation");
  assert.match(css, /\.t3plus-home\s*\{[\s\S]*max-width: calc\(100vw - 1rem\)/);
  assert.match(css, /\.t3plus-w-now-label\s*\{[\s\S]*bottom: calc\(100% - 0\.375rem\)/);
  assert.match(css, /\.t3plus-details-pool \.t3plus-w-pool-head\s*\{[\s\S]*flex-wrap: wrap/);
  const { createDomWatcher } = await import("../src/domWatcher.js");
  const dom = createDom("/", "<div></div>");
  let runs = 0;
  const watcher = createDomWatcher({ win: dom.window, doc: dom.window.document, check: () => (runs += 1), throttleMs: 10_000 });
  watcher.start();
  assert.equal(runs, 1);
  watcher.schedule(); // throttled: waits ~10 s
  dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate")); // a navigation
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs, 2, "ran right away after the navigation");
  dom.window.document.body.append(dom.window.document.createElement("p")); // the new route renders
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs, 3, "still unthrottled during the burst");
  watcher.stop();
});
