import { CONFIG_LIMITS, STORAGE_KEYS } from "./config.js";
import { HOME_FEED_ENDPOINT } from "./hosts.js";
import { profileIncludesProject } from "./sidebar.js";

// t3plus-home.json (server/publish_home.py) -> what the home widgets show.
// Pure functions, no DOM, so every number on the home page is unit-tested.

const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

function cleanWindow(w) {
  if (!w || typeof w !== "object" || typeof w.usedPercent !== "number") return null;
  return {
    label: text(w.label, 40) || "Window",
    kind: text(w.kind, 24),
    durationMins: typeof w.durationMins === "number" ? w.durationMins : null,
    usedPercent: Math.max(0, Math.min(100, w.usedPercent)),
    resetsAt: iso(w.resetsAt),
  };
}

/** Validates the feed. Never throws; returns null for anything unusable. */
export function parseHomeFeedText(raw) {
  if (typeof raw !== "string" || raw.length > CONFIG_LIMITS.maxChars * 4) return null;
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || d.version !== 1) return null;
  const projects = (Array.isArray(d.projects) ? d.projects : []).slice(0, 500).map((p) => ({ title: text(p?.title, 60), root: text(p?.root, 260) }));
  const activity = new Map();
  for (const [day, cells] of Object.entries(d.activity && typeof d.activity === "object" ? d.activity : {})) {
    if (!isDay(day) || !Array.isArray(cells)) continue;
    activity.set(day, cells.filter((c) => Array.isArray(c) && c.length >= 3).map(([p, t, r]) => [num(p), num(t), num(r)]));
  }
  const spend = new Map();
  for (const [day, byProvider] of Object.entries(d.spend && typeof d.spend === "object" ? d.spend : {})) {
    if (!isDay(day) || !byProvider || typeof byProvider !== "object") continue;
    spend.set(day, Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k.slice(0, 24), [num(v?.[0]), num(v?.[1])]])));
  }
  const limits = d.limits && typeof d.limits === "object" ? d.limits : {};
  const claude = (Array.isArray(limits.claude) ? limits.claude : []).slice(0, 8).map((c) => ({
    id: text(c?.id, 60),
    label: text(c?.label, 32) || "Claude",
    plan: text(c?.plan, 40),
    checkedAt: iso(c?.checkedAt),
    windows: (Array.isArray(c?.windows) ? c.windows : []).map(cleanWindow).filter(Boolean),
  }));
  const codex =
    limits.codex && Array.isArray(limits.codex.accounts)
      ? {
          checkedAt: iso(limits.codex.checkedAt),
          accounts: limits.codex.accounts.slice(0, 32).map((a, i) => ({
            label: text(a?.label, 32) || `Account ${i + 1}`,
            plan: text(a?.plan, 40),
            windows: (Array.isArray(a?.windows) ? a.windows : []).map(cleanWindow).filter(Boolean),
          })),
        }
      : null;
  const history = (Array.isArray(d.limitHistory) ? d.limitHistory : [])
    .filter((h) => iso(h?.t) && typeof h.weekCap === "number" && h.weekCap > 0)
    .map((h) => ({ t: Date.parse(h.t), weekLeft: num(h.weekLeft), weekCap: num(h.weekCap) }))
    .sort((a, b) => a.t - b.t);
  const automations = (Array.isArray(d.automations) ? d.automations : []).slice(0, 100).map((a) => ({
    title: text(a?.title, 80),
    project: typeof a?.project === "number" ? a.project : null,
    threadKey: typeof a?.threadKey === "string" && /^[^:\s]+:\S+$/.test(a.threadKey) ? a.threadKey : null,
    nextRunAt: iso(a?.nextRunAt),
    lastRunAt: iso(a?.lastRunAt),
    lastStatus: text(a?.lastStatus, 20),
  }));
  // Recorded pools: [unix seconds, left, cap, (five-hour left, five-hour cap)] in percent of a Plus week.
  const series = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((v) => typeof v === "number" && Number.isFinite(v)) && p[2] > 0)
      .slice(-2000)
      .map(([t, left, cap]) => ({ t: t * 1000, left: Math.max(0, left), cap }))
      .sort((a, b) => a.t - b.t);
  return {
    generatedAt: iso(d.generatedAt),
    projects,
    activity,
    spend,
    claude,
    codex,
    history,
    automations,
    codexSeries: series(d.codexSeries),
    // The optional activity source: AI tokens per day, all providers.
    // {day: [total, {provider: tokens}]} (or a bare total from older feeds).
    aiActivity: new Map(
      Object.entries(d.aiActivity && typeof d.aiActivity === "object" ? d.aiActivity : {}).flatMap(([day, v]) => {
        const total = Array.isArray(v) ? v[0] : v;
        if (!isDay(day) || typeof total !== "number" || !Number.isFinite(total) || total < 0) return [];
        const raw = Array.isArray(v) && v[1] && typeof v[1] === "object" ? v[1] : {};
        const providers = Object.fromEntries(Object.entries(raw).filter(([, n]) => typeof n === "number" && n > 0).map(([k, n]) => [k.slice(0, 24), n]));
        return [[day, { total, providers }]];
      }),
    ),
    claudeSeries: series(d.claudeSeries),
  };
}

/** Indexes of the feed's projects that belong to the profile (null profile = all). */
export function profileProjectSet(feed, profile) {
  const set = new Set();
  feed.projects.forEach((p, i) => {
    if (!profile || profileIncludesProject(profile, p.root) || profileIncludesProject(profile, p.title)) set.add(i);
  });
  return set;
}

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Threads and turns per day for the profile's projects. */
export function dailyActivity(feed, projectSet) {
  const out = new Map();
  for (const [day, cells] of feed.activity) {
    let threads = 0;
    let runs = 0;
    for (const [p, t, r] of cells) {
      if (!projectSet.has(p)) continue;
      threads += t;
      runs += r;
    }
    if (threads || runs) out.set(day, { threads, runs });
  }
  return out;
}

/**
 * GitHub-style heatmap: `weeks` columns ending with the current week
 * (Sunday-first), each cell a level 0-4 by turns, with quartile thresholds
 * over the active days so one huge day does not wash out the rest.
 */
/** The activity source's tokens per day as a heatmap input (value in `runs`, so heatmap() levels it). */
export function tokenDaily(feed) {
  const out = new Map();
  for (const [day, v] of feed.aiActivity) if (v.total > 0) out.set(day, { threads: 0, runs: v.total, providers: v.providers });
  return out;
}

export function heatmap(daily, now, weeks = 26) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  const values = [...daily.values()].map((v) => v.runs).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f) => values[Math.min(values.length - 1, Math.floor(values.length * f))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const columns = [];
  let threads = 0;
  let runs = 0;
  let activeDays = 0;
  for (let w = 0; w < weeks; w += 1) {
    const column = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = dayKey(date);
      const v = daily.get(key) ?? { threads: 0, runs: 0 };
      const future = date > end;
      if (!future) {
        threads += v.threads;
        runs += v.runs;
        if (v.runs) activeDays += 1;
      }
      const level = future || !v.runs ? 0 : v.runs <= cuts[0] ? 1 : v.runs <= cuts[1] ? 2 : v.runs <= cuts[2] ? 3 : 4;
      column.push({ key, level, threads: v.threads, runs: v.runs, future, today: key === dayKey(end) });
    }
    columns.push(column);
  }
  return { columns, threads, runs, activeDays, start, end };
}

/** Claude Max ($100 plan) is 5x Claude Pro ($20). */
export const claudeWeight = (plan) => (/max/i.test(plan) ? 5 : 1);

/** Pro is 10x Plus, the scale T3 and the Limits page use. */
export const planWeight = (plan) => (/pro/i.test(plan) ? 10 : 1);
const isWeekly = (w) => (w.durationMins ?? 0) >= 1440 || w.kind === "weekly";
const isFiveHour = (w) => !isWeekly(w) && ((w.durationMins ?? 0) > 0 || w.kind === "session");

// ---------- Pools (weekly pool charts, compact) ----------

const HOUR = 3600000;

/**
 * Projects a pool forward "as usual": the recorded burn rate of the last day
 * (only the drops count; refills are not burn), plus each account's weekly
 * refill at its reset time. Returns points every 30 minutes and when the pool
 * first runs out.
 */
export function projectPool({ recorded, left, cap, refills, now, until }) {
  const dayAgo = now - 24 * HOUR;
  const recent = recorded.filter((p) => p.t >= dayAgo);
  let drop = 0;
  for (let i = 1; i < recent.length; i += 1) drop += Math.max(0, recent[i - 1].left - recent[i].left);
  const span = recent.length > 1 ? (recent.at(-1).t - recent[0].t) / HOUR : 0;
  const burn = span >= 2 ? drop / span : 0; // percent per hour
  const points = [{ t: now, left }];
  const queue = [...refills].filter((r) => r.at > now && r.at <= until).sort((a, b) => a.at - b.at);
  let value = left;
  let runsOutAt = left <= 0 ? now : null;
  const step = HOUR / 2;
  for (let t = now + step; t <= until; t += step) {
    value = Math.max(0, value - burn * (step / HOUR));
    while (queue.length && queue[0].at <= t) value = Math.min(cap, value + queue.shift().amount);
    if (value <= 0 && runsOutAt === null) runsOutAt = t;
    points.push({ t, left: value });
  }
  return { points, burn, runsOutAt };
}

const weeklyRefills = (accounts, weightOf) =>
  accounts.flatMap((a) => {
    const weekly = a.windows.find(isWeekly);
    if (!weekly?.resetsAt || !weekly.usedPercent) return [];
    return [{ at: Date.parse(weekly.resetsAt), amount: Math.round(weightOf(a) * (weekly.usedPercent / 100)) }];
  });

/**
 * One pool for the chart: current left/cap, recorded line, projection, refills.
 * Codex: every Codex Gateway account's week in Plus weeks (Pro = 10x).
 * Claude: every Claude account's weekly window, 100% each.
 */
export function poolModel(feed, kind, now = Date.now(), { back = 3, ahead = 3 } = {}) {
  if (!feed) return null;
  let accounts;
  let weightOf;
  let recorded;
  if (kind === "codex") {
    if (!feed.codex?.accounts.length) return null;
    accounts = feed.codex.accounts;
    weightOf = (a) => planWeight(a.plan) * 100;
    recorded = feed.codexSeries;
  } else {
    accounts = feed.claude.map((c) => ({ label: c.label, plan: c.plan, windows: c.windows }));
    if (!accounts.some((a) => a.windows.some(isWeekly))) return null;
    accounts = accounts.filter((a) => a.windows.some(isWeekly));
    // Claude Max ($100) is 5x Claude Pro ($20). T3 reports both Max tiers as "Claude Max".
    weightOf = (a) => claudeWeight(a.plan) * 100;
    recorded = feed.claudeSeries;
  }
  let cap = 0;
  let left = 0;
  let fiveCap = 0;
  let fiveLeft = 0;
  for (const a of accounts) {
    const w = weightOf(a);
    const weekly = a.windows.find(isWeekly);
    const five = a.windows.find(isFiveHour);
    cap += w;
    left += w * (1 - (weekly?.usedPercent ?? 0) / 100);
    if (five) {
      fiveCap += w;
      fiveLeft += w * (1 - five.usedPercent / 100);
    }
  }
  const from = now - back * 24 * HOUR;
  const until = now + ahead * 24 * HOUR;
  const refills = weeklyRefills(accounts, weightOf).filter((r) => r.at > now);
  const shown = recorded.filter((p) => p.t >= from && p.t <= now);
  const projection = projectPool({ recorded, left, cap, refills, now, until });
  const nextRefill = refills.sort((a, b) => a.at - b.at)[0] ?? null;
  return {
    kind,
    cap: Math.round(cap),
    left: Math.round(left),
    fiveCap: Math.round(fiveCap),
    fiveLeft: Math.round(fiveLeft),
    accounts: accounts.length,
    from,
    until,
    now,
    recorded: [...shown, { t: now, left }],
    projected: projection.points,
    burn: projection.burn,
    runsOutAt: projection.runsOutAt,
    refills: refills.filter((r) => r.at <= until),
    nextRefill,
  };
}

/** Quick activity numbers: turns this week (Sunday on), current streak, best day. */
export function activityStats(daily, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let week = 0;
  for (let i = 0; i <= today.getDay(); i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    week += daily.get(dayKey(d))?.runs ?? 0;
  }
  let streak = 0;
  const d = new Date(today);
  if (!daily.get(dayKey(d))?.runs) d.setDate(d.getDate() - 1); // today may not have started yet
  while (daily.get(dayKey(d))?.runs) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  let best = 0;
  for (const v of daily.values()) best = Math.max(best, v.runs);
  return { week, streak, best };
}

/** Tokens per provider per day for the last `days` days (T3's usage chart), plus month totals. */
export function tokenSeries(feed, now, days = 14) {
  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    keys.push(dayKey(d));
  }
  const providers = new Set();
  for (const key of keys) for (const p of Object.keys(feed.spend.get(key) ?? {})) providers.add(p);
  const order = ["codex", "claude", ...[...providers].filter((p) => p !== "codex" && p !== "claude").sort()];
  const series = order
    .filter((p) => providers.has(p))
    .map((p) => ({ provider: p, values: keys.map((k) => feed.spend.get(k)?.[p]?.[1] ?? 0) }))
    .filter((s) => s.values.some((v) => v > 0));
  const monthStart = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const month = {};
  for (const [day, byProvider] of feed.spend) {
    if (day < monthStart || day > dayKey(now)) continue;
    for (const [p, [cost, tokens]] of Object.entries(byProvider)) {
      month[p] ??= { cost: 0, tokens: 0 };
      month[p].cost += cost;
      month[p].tokens += tokens;
    }
  }
  return { days: keys, series, month };
}

export const formatPercent = (v) => `${Math.round(v).toLocaleString("en-US")}%`;
export const formatUsd = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(v >= 100 ? 0 : 2)}`);

export function formatTokens(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

/** Loads the feed through the background worker; falls back to the cached copy. */
/**
 * Which pool belongs to the model in T3's composer picker, from its label
 * ("Claude Opus 5.5, High", "GPT-6.1 Sol, High"): "claude", "codex" or null.
 */
export function providerKind(label) {
  const text = String(label ?? "");
  if (/\b(claude|opus|sonnet|haiku|fable)\b/i.test(text)) return "claude";
  if (/\b(gpt|codex|o[1-9])\b|\bgpt-|\b(sol|terra|astra)\b/i.test(text)) return "codex";
  return null;
}

export function createHomeFeed({ area, fetchRemote, endpoint = HOME_FEED_ENDPOINT }) {
  const key = STORAGE_KEYS.homeFeedCache;
  async function readCache() {
    const value = (await area.get(key))?.[key];
    return typeof value?.text === "string" ? parseHomeFeedText(value.text) : null;
  }
  return {
    endpoint,
    readCache,
    async load() {
      let response = null;
      try {
        response = await fetchRemote(endpoint);
      } catch {
        response = null;
      }
      const parsed = response?.ok ? parseHomeFeedText(response.text) : null;
      if (parsed) {
        await area.set({ [key]: { text: response.text } });
        return parsed;
      }
      return readCache();
    },
  };
}
