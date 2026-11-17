// Measures what t3+ costs a T3 tab over one scripted session in headless
// Chromium, on the harness fixture. Run `npm run build` first.
//   CHROME=path/to/chrome node harness/perf.mjs [--runs 3] [--out file.json] [--bare] [--port 4381]
// --bare serves an empty content.js, for the fixture's own cost without t3+.
//
// The session (each phase is measured on its own):
//   load        open a thread page with the glow, glass, bots, the Assistant group and tasks
//   idle        12 s with nothing happening
//   stream      12 s of a reply streaming into T3's message list (30 tokens/s,
//               autoscroll, a new paragraph every 10 tokens) and a one-second
//               ticker outside the list, as T3's "working" status updates
//   hidden      12 s of the same stream while the tab is hidden
//   return      3 s after the tab is visible again
//   navigate    4 client-side route changes, one per second
//   draft       open the new-thread page (home widgets, tasks) and wait 12 s
//   reload      open the thread page again: what a second page load writes
//
// Intervals of 30 s or more run 20 times faster (a 60 s feed poll fires every
// 3 s), so each phase covers several polls. Counts per phase come from
// wrappers installed before any page script, and from V8 call counts.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withAssistantIds } from "./fixture.mjs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]] : [])));
const chrome = process.env.CHROME;
if (!chrome) {
  console.error("Set CHROME to a Chrome or Chromium binary.");
  process.exit(1);
}
const runs = Number(args.runs ?? 1);
const bare = Boolean(args.bare);
const port = Number(args.port ?? 4381);
const SCALE = 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// t3+ functions whose call counts are reported for every phase.
const WATCHED = [
  "checkDom", "syncSidebar", "scanSidebar", "decorateBotRows", "syncAssistantGroup", "syncDither", "syncHome", "syncThreadDetails",
  "syncGlassMaterial", "syncComposerSurfaces", "syncCompactHeader", "syncSettingsSection", "render", "refreshBotFeed", "refreshHomeFeed",
  "syncHoverCards", "isNoise", "glowPixelArt", "ditherRgbInPlace", "computedColor", "paintRgb", "botArt",
];

// Installed before any page script. Counts what t3+ asks the browser to do.
const INSTRUMENT = String.raw`(() => {
  const SCALE = ${SCALE};
  const counts = {};
  const inc = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
  const native = { setTimeout: window.setTimeout.bind(window), setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window) };
  const P = (window.__perf = { counts, native, inc, take() { const out = { ...counts }; for (const k of Object.keys(counts)) delete counts[k]; return out; } });
  const wrap = (obj, name, key, fn) => { const orig = obj[name]; if (typeof orig !== "function") return; obj[name] = function (...a) { inc(key); return fn ? fn.call(this, orig, a) : orig.apply(this, a); }; };
  wrap(window, "setTimeout", "setTimeout", (orig, [cb, ms, ...rest]) => orig.call(window, cb, ms >= 30000 ? ms / SCALE : ms, ...rest));
  wrap(window, "setInterval", "setInterval", (orig, [cb, ms, ...rest]) => orig.call(window, cb, ms >= 30000 ? ms / SCALE : ms, ...rest));
  wrap(window, "requestAnimationFrame", "requestAnimationFrame");
  wrap(window, "getComputedStyle", "getComputedStyle");
  wrap(window, "fetch", "fetch");
  wrap(Element.prototype, "getBoundingClientRect", "getBoundingClientRect");
  wrap(Document.prototype, "querySelector", "querySelector");
  wrap(Document.prototype, "querySelectorAll", "querySelectorAll");
  wrap(Element.prototype, "querySelector", "querySelector");
  wrap(Element.prototype, "querySelectorAll", "querySelectorAll");
  wrap(HTMLCanvasElement.prototype, "toBlob", "canvas.toBlob");
  wrap(HTMLCanvasElement.prototype, "toDataURL", "canvas.toDataURL");
  wrap(CanvasRenderingContext2D.prototype, "getImageData", "canvas.getImageData");
  wrap(CanvasRenderingContext2D.prototype, "putImageData", "canvas.putImageData");
  wrap(URL, "createObjectURL", "URL.createObjectURL");
  wrap(Storage.prototype, "setItem", "localStorage.setItem", function (orig, [k, v]) { if (!String(k).startsWith("stub:") && !String(k).startsWith("perfsync:")) inc("localStorage.bytes", String(v).length); return orig.call(this, k, v); });
  const MO = window.MutationObserver;
  window.MutationObserver = class extends MO {
    constructor(cb) { super((records, obs) => { inc("observer.callbacks"); inc("observer.records", records.length); return cb(records, obs); }); inc("observer.created"); }
  };
  const RO = window.ResizeObserver;
  window.ResizeObserver = class extends RO {
    constructor(cb) { super((entries, obs) => { inc("resizeObserver.callbacks"); return cb(entries, obs); }); }
  };
  // Visibility the session can switch (headless tabs never hide on their own).
  let hidden = false;
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => hidden });
  P.setHidden = (value) => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); };
  // chrome.* comes from harness/chrome-stub.js; count its traffic and add a Chrome Sync area.
  let chromeApi;
  const syncArea = {
    async get(keys) { inc("sync.get"); const out = {}; for (const k of [].concat(keys)) { const raw = localStorage.getItem("perfsync:" + k); if (raw !== null) out[k] = JSON.parse(raw); } return out; },
    async set(items) { inc("sync.set"); for (const [k, v] of Object.entries(items)) { inc("sync.items"); inc("sync.bytes", JSON.stringify(v).length); localStorage.setItem("perfsync:" + k, JSON.stringify(v)); } },
    async remove(keys) { inc("sync.remove"); for (const k of [].concat(keys)) localStorage.removeItem("perfsync:" + k); },
  };
  Object.defineProperty(window, "chrome", { configurable: true, get: () => chromeApi, set(value) {
    chromeApi = value;
    const local = value.storage.local;
    // The stub reads one key at a time; t3+ also asks for several (backup.js).
    const getOne = local.get.bind(local);
    local.get = async (keys) => {
      inc("storage.get");
      if (!Array.isArray(keys)) return getOne(keys);
      return Object.assign({}, ...(await Promise.all(keys.map((k) => getOne(k)))));
    };
    wrap(local, "set", "storage.set", (orig, [items]) => { for (const [k, v] of Object.entries(items)) { inc("storage.set:" + k); inc("storage.bytes", JSON.stringify(v).length); } return orig.call(local, items); });
    value.storage.sync = syncArea;
    const send = value.runtime.sendMessage;
    value.runtime.sendMessage = (message, cb) => { inc("message:" + (message?.type === "t3plus/fetch-config" ? String(message.url).split("/").pop() : message?.type)); return send.call(value.runtime, message, cb); };
    const add = value.storage.onChanged.addListener;
    value.storage.onChanged.addListener = (fn) => add((changes, area) => { inc("storage.onChanged.calls"); return fn(changes, area); });
  } });
  // A reply streaming in, as T3 renders it: text grows in the last message, a
  // new paragraph now and then, the list scrolled to the bottom, and a status
  // line outside the list ticking every second.
  P.stream = (ms) => new Promise((resolve) => {
    const list = document.querySelector(".timeline");
    if (!list) return resolve(0);
    list.classList.add("messages-timeline-scroll");
    const turn = document.createElement("div");
    turn.className = "turn";
    const body = document.createElement("div");
    turn.append(body);
    list.append(turn);
    let p = null, text = null, n = 0;
    const header = document.querySelector(".workspace-header .crumbs") ?? document.body;
    const status = document.createElement("span");
    status.className = "muted";
    header.append(status);
    const words = "the redirect target is read from the state parameter and checked against the allowed paths before".split(" ");
    const tokens = native.setInterval(() => {
      if (n % 10 === 0) { p = document.createElement("p"); text = document.createTextNode(""); p.append(text); body.append(p); }
      text.appendData(words[n % words.length] + " ");
      n += 1;
      list.scrollTop = list.scrollHeight;
    }, 33);
    let seconds = 0;
    const tick = native.setInterval(() => { status.textContent = "Working for " + ++seconds + "s"; }, 1000);
    native.setTimeout(() => { native.clearInterval(tokens); native.clearInterval(tick); resolve(n); }, ms);
  });
  // A client-side route change, as T3's router does it: new URL, new breadcrumbs, new messages.
  P.navigate = (path) => {
    history.pushState({}, "", path + location.search);
    const crumbs = document.querySelector(".workspace-header .crumbs");
    if (crumbs) crumbs.innerHTML = "<span class=muted>acme-api</span><span class=sep>/</span><span>" + path + "</span>";
    const list = document.querySelector(".timeline");
    if (list) list.innerHTML = "<div class=turn><div><p>Route " + path + "</p></div></div>";
  };
})();`;

// The same fixtures as harness/screenshot.mjs, sized for one session.
const config = await readFile(new URL("./t3plus.harness.json", import.meta.url), "utf8");
const bots = JSON.parse(withAssistantIds(JSON.stringify({ "env1:bot1": { shape: "circle", color: "blue" }, "env2:bot2": { shape: "triangle", color: "orange" }, "env2:bot3": { shape: "hexagon", color: "purple" } })));
const feed = withAssistantIds(JSON.stringify({
  version: 1,
  environmentId: "env1",
  bots: {
    bot1: { role: "assistant", text: "Spawned 3 sub-threads for tonight's sync.", model: "Opus 5.5", computer: "studio-mac", projectId: "p-ops", status: "working", children: 2 },
    bot2: { role: "assistant", text: "Merged 2 dependency bumps.", model: "GPT-6.1 Sol", computer: "studio-mac" },
    bot3: { role: "user", text: "archive anything older than a week", model: "Sonnet 5.5", computer: "build-box" },
  },
  threads: {
    o1: { title: "Draft the release notes", projectId: "p-ops", status: "working", children: 3 },
    o9: { title: "Book the team offsite venue", projectId: "p-ops", status: "working", children: 1 },
    o3: { title: "Worker: check tomorrow's calendar", projectId: "p-ops", status: "idle" },
  },
}));
const seed = { version: 2, composerGradient: { enabled: true, mode: "half-circle", intensity: 60 }, glass: { enabled: true, strength: 60 }, sidebar: { profiles: true, bots: true, titleFirst: true, compactHeader: true } };
const query = (extra = {}) => {
  const q = new URLSearchParams({ seed: JSON.stringify(seed), config, bots: JSON.stringify(bots), feed, group: "", tasks: "", ...extra });
  return q.toString();
};
// --print-query: the thread page's query string, to open the same page by hand.
if (args["print-query"]) {
  console.log(query());
  process.exit(0);
}
const homeFeed = JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), projects: [], activity: {}, spend: {}, limits: { claude: [], codex: { accounts: [] } }, codexSeries: [], claudeSeries: [] });
await writeFile(new URL("./out/home-feed.json", import.meta.url), homeFeed).catch(async () => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(new URL("./out/", import.meta.url), { recursive: true });
  await writeFile(new URL("./out/home-feed.json", import.meta.url), homeFeed);
});

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  socket.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(String(data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) handlers.get(msg.method)?.(msg.params);
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    on: (method, fn) => handlers.set(method, fn),
    close: () => socket.close(),
  };
}

/** t3+'s own CPU time: every sampled stack that runs through content.js, from its outermost content.js frame down. */
function scriptTime(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const ours = (n) => n.callFrame.url.endsWith("/dist/content.js");
  const inScript = new Map();
  const isIn = (id) => {
    if (inScript.has(id)) return inScript.get(id);
    const n = byId.get(id);
    const result = ours(n) || (parent.has(id) && isIn(parent.get(id)));
    inScript.set(id, result);
    return result;
  };
  const self = new Map();
  const deltas = profile.timeDeltas;
  let ms = 0;
  for (let i = 0; i < profile.samples.length; i += 1) {
    const id = profile.samples[i];
    const dt = (deltas[i + 1] ?? 0) / 1000;
    if (!isIn(id)) continue;
    ms += dt;
    const name = byId.get(id).callFrame.functionName || "(anonymous)";
    self.set(name, (self.get(name) ?? 0) + dt);
  }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, t]) => [name, Math.round(t * 10) / 10]);
  return { ms: Math.round(ms * 10) / 10, top };
}

const METRICS = ["TaskDuration", "ScriptDuration", "RecalcStyleDuration", "LayoutDuration", "RecalcStyleCount", "LayoutCount"];

async function session(chromePath) {
  const profileDir = await mkdtemp(join(tmpdir(), "t3plus-perf-"));
  const child = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--mute-audio",
    `--user-data-dir=${profileDir}`, "--remote-debugging-port=0", "--window-size=1333,959", "--force-device-scale-factor=1.5", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const wsLine = await new Promise((resolve, reject) => {
    let buf = "";
    child.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\S+)/);
      if (m) resolve(m[1]);
    });
    child.on("exit", () => reject(new Error("chrome exited")));
  });
  const httpBase = wsLine.replace(/^ws:\/\/([^/]+).*/, "http://$1");
  const target = (await (await fetch(`${httpBase}/json/list`)).json()).find((t) => t.type === "page");
  const cdp = await connect(target.webSocketDebuggerUrl);
  const result = { phases: {} };
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
    if (bare) {
      await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/dist/content.js" }] });
      cdp.on("Fetch.requestPaused", ({ requestId }) => cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/javascript" }], body: "" }));
    }
    await cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
    const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const calls = async () => {
      const { result: scripts } = await cdp.send("Profiler.takePreciseCoverage");
      const out = {};
      for (const script of scripts) {
        if (!script.url.endsWith("/dist/content.js")) continue;
        for (const fn of script.functions) {
          const name = fn.functionName.replace(/\d+$/, "");
          if (WATCHED.includes(name)) out[name] = (out[name] ?? 0) + fn.ranges[0].count;
        }
      }
      return out;
    };
    const loaded = async (url) => {
      const done = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
      await cdp.send("Page.navigate", { url });
      await done;
    };

    async function phase(name, body, { navigates = false } = {}) {
      await calls(); // reset counters
      await evaluate("window.__perf?.take()");
      const before = await metrics();
      await cdp.send("Profiler.start");
      const started = Date.now();
      await body();
      const { profile } = await cdp.send("Profiler.stop");
      const after = await metrics();
      const counts = (await evaluate("window.__perf?.take()")) ?? {};
      const fnCalls = await calls();
      // A navigation starts the page's counters again.
      const from = (m) => (navigates ? 0 : before[m]);
      const delta = Object.fromEntries(METRICS.map((m) => [m, m.endsWith("Count") ? after[m] - from(m) : Math.round((after[m] - from(m)) * 10000) / 10]));
      result.phases[name] = {
        seconds: (Date.now() - started) / 1000,
        t3plusScriptMs: scriptTime(profile),
        browser: delta,
        heapMB: Math.round(after.JSHeapUsedSize / 1e5) / 10,
        nodes: after.Nodes,
        counts,
        calls: fnCalls,
      };
    }

    const base = `http://127.0.0.1:${port}`;
    await phase("load", async () => {
      await loaded(`${base}/env1/o1?${query()}`);
      await sleep(4000);
    });
    await phase("idle", () => sleep(12000));
    await phase("stream", () => evaluate("__perf.stream(12000)"));
    await phase("hidden", async () => {
      await evaluate("__perf.setHidden(true)");
      await evaluate("__perf.stream(12000)");
    });
    await phase("return", async () => {
      await evaluate("__perf.setHidden(false)");
      await sleep(3000);
    });
    await phase("navigate", async () => {
      for (const path of ["/env1/a1", "/env1/a2", "/env1/o1", "/env2/t1"]) {
        await evaluate(`__perf.navigate(${JSON.stringify(path)})`);
        await sleep(1000);
      }
    });
    await phase("draft", async () => {
      await loaded(`${base}/draft/new1?${query({ home: "1" })}`);
      await sleep(12000);
    }, { navigates: true });
    await phase("reload", async () => {
      await loaded(`${base}/env1/o1?${query()}`);
      await sleep(4000);
    }, { navigates: true });
  } finally {
    cdp.close();
    child.kill();
    await sleep(500);
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  return result;
}

const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "pipe" });
await new Promise((resolve) => server.stdout.once("data", resolve));
const all = [];
try {
  for (let i = 0; i < runs; i += 1) all.push(await session(chrome));
} finally {
  server.kill();
}

// Median per number across runs.
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
function merge(objects) {
  const first = objects[0];
  if (typeof first === "number") return median(objects);
  if (Array.isArray(first) || typeof first !== "object" || first === null) return first;
  const keys = new Set(objects.flatMap((o) => Object.keys(o ?? {})));
  return Object.fromEntries([...keys].map((k) => [k, merge(objects.map((o) => o?.[k] ?? (typeof first[k] === "number" ? 0 : first[k])))]));
}
const summary = merge(all);
summary.runs = runs;
summary.bare = bare;
const text = JSON.stringify(summary, null, 2);
if (args.out) await writeFile(args.out, text);
console.log(text);
