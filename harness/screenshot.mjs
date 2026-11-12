// Renders the T3-shaped harness fixture in headless Chrome and saves PNGs to
// harness/out/. The fixture copies T3's own layout so each screenshot shows
// how small the t3+ overlay is. Run `npm run build` first.
//   CHROME=path/to/chrome node harness/screenshot.mjs
// Output is 2000x1438 (1333x959 CSS px at 1.5x), the size of the reference
// T3 screenshot, so the two can be compared side by side.
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const chrome = process.env.CHROME;
if (!chrome) {
  console.error("Set CHROME to a Chrome or chrome-headless-shell binary.");
  process.exit(1);
}
const port = 4379;
const outDir = fileURLToPath(new URL("./out/", import.meta.url));
await mkdir(outDir, { recursive: true });
// Old scenario names must not linger next to the new ones.
for (const file of await readdir(outDir)) if (file.endsWith(".png")) await rm(`${outDir}${file}`);

const server = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url)), String(port)], { stdio: "pipe" });
await new Promise((resolve) => server.stdout.once("data", resolve));

const config = await readFile(new URL("./t3plus.harness.json", import.meta.url), "utf8");
const settings = ({ background = false, mode = "half-circle", glass = true, ...gradient } = {}) => ({
  version: 2,
  composerGradient: { enabled: background, mode, intensity: 55, ...gradient },
  glass: { enabled: glass, strength: 60 },
  sidebar: { profiles: true, bots: true },
});
// Synthetic home feed (no real data): 26 weeks of activity, limits, spend, automations.
function homeFeed() {
  const now = new Date();
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const activity = {};
  const spend = {};
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 182; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const ramp = Math.max(0, 1 - i / 140);
    if (rand() < 0.25 + ramp * 0.6) activity[day(d)] = [[0, Math.round(rand() * 6 * ramp + 1), Math.round(rand() * 60 * ramp + 2)], [1, Math.round(rand() * 2), Math.round(rand() * 12)]];
    if (i < 62) spend[day(d)] = { codex: [Math.round(rand() * 900) / 100, 1e6], claude: [Math.round(rand() * 1400) / 100, 2e6] };
  }
  const iso = (h) => new Date(now.getTime() + h * 3600000).toISOString();
  const history = Array.from({ length: 60 }, (_, i) => ({ t: iso(-118 + i * 2), weekLeft: Math.round(1450 - i * 13 + (i > 40 ? 300 : 0)), weekCap: 1700 }));
  const plus = (label, used5, usedW, resetH) => ({ label, plan: "ChatGPT Plus Subscription", windows: [{ label: "Session", kind: "session", durationMins: 300, usedPercent: used5, resetsAt: iso(3) }, { label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: usedW, resetsAt: iso(resetH) }] });
  return JSON.stringify({
    version: 1,
    generatedAt: now.toISOString(),
    projects: [{ title: "acme-api", root: "github.com/acme/api" }, { title: "notes", root: "/home/me/notes" }],
    activity,
    spend,
    limits: {
      claude: [{ id: "claudeAgent", label: "Claude", plan: "Claude Pro", windows: [{ label: "Session", kind: "session", durationMins: 300, usedPercent: 13, resetsAt: iso(2.7) }, { label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 85, resetsAt: iso(52) }] },
        { id: "claude_work", label: "Work", plan: "Claude Max", windows: [{ label: "Session", kind: "session", durationMins: 300, usedPercent: 34, resetsAt: iso(1.6) }, { label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 36, resetsAt: iso(125) }] }],
      codex: { accounts: [{ label: "Pro", plan: "ChatGPT Pro Subscription", windows: [{ label: "Weekly", kind: "weekly", durationMins: 10080, usedPercent: 45, resetsAt: iso(30) }] },
        plus("A", 0, 100, 20), plus("B", 20, 60, 40), plus("C", 0, 10, 90), plus("D", 80, 100, 8), plus("E", 0, 30, 70), plus("F", 5, 0, 100), plus("G", 0, 55, 60)] },
    },
    limitHistory: history,
    // Recorded pools (every 30 minutes, 3 days): Codex drains with one refill; Claude drains slowly.
    codexSeries: Array.from({ length: 145 }, (_, i) => {
      const t = Math.floor(now.getTime() / 1000) - (144 - i) * 1800;
      return [t, Math.max(0, Math.round(1300 - i * 6 + (i > 90 ? 500 : 0))), 1700];
    }),
    claudeSeries: Array.from({ length: 145 }, (_, i) => [Math.floor(now.getTime() / 1000) - (144 - i) * 1800, Math.round(420 - i * 0.5), 600]),
    // An activity source: AI tokens per day.
    aiActivity: Object.fromEntries(Array.from({ length: 140 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const v = Math.max(0, Math.round((Math.sin(i * 1.7) + Math.cos(i * 0.31)) * 4e8 + (140 - i) * 6e6));
      return [key, i % 9 === 4 ? 0 : v];
    })),
    automations: [
      { title: "Daily inbox cleanup", project: 1, threadKey: "env2:n1", nextRunAt: iso(0.6), lastStatus: "succeeded" },
      { title: "Nightly dependency check", project: 0, threadKey: "env1:a1", nextRunAt: iso(3.2), lastStatus: "failed" },
      { title: "Weekly notes digest", project: 1, threadKey: "env2:n2", nextRunAt: iso(26), lastStatus: "succeeded" },
      { title: "Release notes draft", project: 0, threadKey: "env1:a2", nextRunAt: iso(50), lastStatus: "succeeded" },
    ],
  });
}

// Three marked bot rows; shape and color as a user would set them in Settings.
const bots = { "env1:bot1": { shape: "circle", color: "blue" }, "env2:bot2": { shape: "triangle", color: "orange" }, "env2:bot3": { shape: "hexagon", color: "purple" }, "env2:bot4": { shape: "circle", color: "pink" }, "env2:bot5": { shape: "square", color: "teal" } };
// Latest message per bot, as server/publish_bot_feed.py publishes it.
const feed = JSON.stringify({
  version: 1,
  bots: {
    bot1: { role: "assistant", text: "Spawned 3 sub-threads for tonight's sync. Two finished; the deploy check is still running.", model: "Opus 5.5", computer: "studio-mac" },
    bot2: { role: "assistant", text: "Merged 2 dependency bumps. The lockfile conflict on main still needs a look.", model: "GPT-6.1 Sol", computer: "studio-mac" },
    bot3: { role: "user", text: "archive anything older than a week", model: "Sonnet 5.5", computer: "build-box" },
    bot4: { role: "assistant", text: "3 upgrades ready. Approve the 2 major bumps to open PRs." },
    bot5: { role: "assistant", text: "Queued: waiting for the 2 sub-threads to finish." },
  },
});

// The home feed is too large for a Windows command line, so it is served as a file.
await writeFile(new URL("./out/home-feed.json", import.meta.url), homeFeed());

const scenarios = {
  // T3 as-is plus the two sidebar additions: the profile strip and one decorated bot row. No background.
  "1-sidebar-bot-and-profiles": { path: "/env1/a1", seed: settings(), config, bots },
  // Same, with the Work profile active: rows outside it are hidden in place; the bot stays.
  "2-sidebar-profile-work": { path: "/env1/a1", seed: settings(), config, bots, view: { activeProfileId: "work", lastThreadByProfile: {} } },
  // Background layer behind the conversation, T3's composer card as glass on top.
  "3-composer-glow-glass": { path: "/env1/a1", seed: settings({ background: true, mode: "half-circle", intensity: 65 }), config, bots },
  "3b-glow-grain": { path: "/env1/a1", seed: settings({ background: true, mode: "half-circle", intensity: 65, ditherStyle: "grain" }), config, bots },
  "3c-glow-spectrum": { path: "/env1/a1", seed: settings({ background: true, mode: "half-circle", intensity: 65, ditherStyle: "spectrum" }), config, bots },
  // New-thread page: dithered glow around the composer and the home widgets below it.
  "7-new-thread-home": { path: "/draft/new1", seed: settings({ background: true, mode: "half-circle", intensity: 60 }), config, bots, home: true },
  "4-composer-image-glass": { path: "/env1/a1", seed: settings({ background: true, mode: "image", intensity: 60, imageSource: "sample" }), config, bots },
  // Server t3plus.json unreachable: only All plus the tiny "!" diagnostic.
  "5-config-unavailable": { path: "/env1/a1", seed: settings(), bots },
  // Settings -> Appearance with the t3+ section (where bot icon/accent/label are set).
  // T3's Usage page chart with the dithered fill painted under T3's own SVG.
  "8-usage-page": { path: "/usage", seed: settings(), config, bots },
  "6-settings-appearance": { path: "/settings/appearance", seed: settings({ background: true, mode: "half-circle" }), config, bots, height: 2100 },
};

try {
  for (const [name, s] of Object.entries(scenarios)) {
    const query = new URLSearchParams();
    query.set("seed", JSON.stringify(s.seed));
    if (s.config) query.set("config", s.config);
    if (s.bots) query.set("bots", JSON.stringify(s.bots));
    if (s.bots) query.set("feed", feed);
    if (s.home) query.set("home", "1");
    if (s.view) query.set("view", JSON.stringify(s.view));
    if (s.light) query.set("light", "");
    const url = `http://127.0.0.1:${port}${s.path}?${query}`;
    const file = `${outDir}${name}.png`;
    const profile = `${outDir}chrome-profile-${name}`;
    await new Promise((resolve, reject) => {
      const child = spawn(chrome, [
        "--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
        `--user-data-dir=${profile}`, "--force-device-scale-factor=1.5",
        `--window-size=1333,${s.height ?? 959}`, "--virtual-time-budget=3000",
        `--screenshot=${file}`, url,
      ], { stdio: "ignore" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`chrome exited ${code}`))));
    });
    await rm(profile, { recursive: true, force: true });
    console.log(`wrote ${file}`);
  }
} finally {
  server.kill();
}
