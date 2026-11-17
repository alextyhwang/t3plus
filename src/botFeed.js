import { BOT_LIMITS, CONFIG_LIMITS, STORAGE_KEYS } from "./config.js";
import { BOT_FEED_ENDPOINT } from "./hosts.js";
import { threadIdFromKey } from "./threadKey.js";

// t3plus-bots.json: bot state and schedules, published by
// server/publish_bot_feed.py (read-only on T3's database). Format v1:
//   { version: 1, generatedAt, environmentId,
//     bots: { "<threadId>": { text: "", role: "assistant", at: null, model?, effort?, computer?,
//                             projectId?, status?, pinned?, settled?, snoozed?, children?, updatedAt?, nextRunAt? } },
//     threads?: { "<threadId>": { title, projectId, status, pinned, children, updatedAt } } }
// Keyed by thread id (the part of the sidebar key after "<environmentId>:").
// `threads` lists the active top-level threads of the bots' projects (the
// Assistant group's data for rows T3 is not showing, and sub-thread counts).

const FEED_STATUSES = new Set(["working", "attention", "failed", "idle"]);
const MAX_FEED_THREADS = 400;

/** The shared thread state fields; missing or malformed values become safe defaults. */
function threadState(entry, short) {
  const children = Number(entry.children);
  return {
    projectId: short(entry.projectId, 80),
    status: FEED_STATUSES.has(entry.status) ? entry.status : "idle",
    children: Number.isInteger(children) && children > 0 ? Math.min(children, 999) : 0,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt.slice(0, 40) : null,
    nextRunAt: typeof entry.nextRunAt === "string" && Number.isFinite(Date.parse(entry.nextRunAt)) ? entry.nextRunAt.slice(0, 40) : null,
  };
}

/**
 * @returns {{ entries: Map<string, object>, threads: Map<string, object>,
 *   environmentId: string | null, generatedAt: string | null } | null}
 */
export function parseBotFeedText(text) {
  if (typeof text !== "string" || !text.trim() || text.length > CONFIG_LIMITS.maxChars) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !raw.bots || typeof raw.bots !== "object") return null;
  const short = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const validId = (id) => Boolean(id) && !/\s/.test(id);
  const entries = new Map();
  for (const [threadId, entry] of Object.entries(raw.bots).slice(0, BOT_LIMITS.maxKnownBots)) {
    if (!entry || typeof entry !== "object" || !validId(threadId)) continue;
    const clean = short(entry.text, BOT_LIMITS.maxPreviewChars);
    const model = short(entry.model, 32);
    const computer = short(entry.computer, 32);
    const state = threadState(entry, short);
    if (!clean && !model && !computer && !state.projectId) continue;
    entries.set(threadId, {
      text: clean,
      role: entry.role === "user" ? "user" : "assistant",
      at: typeof entry.at === "string" ? entry.at.slice(0, 40) : null,
      model,
      computer,
      ...state,
    });
  }
  const threads = new Map();
  if (raw.threads && typeof raw.threads === "object") {
    for (const [threadId, entry] of Object.entries(raw.threads).slice(0, MAX_FEED_THREADS)) {
      if (!entry || typeof entry !== "object" || !validId(threadId)) continue;
      const title = short(entry.title, 200);
      if (!title) continue;
      threads.set(threadId, { title, ...threadState(entry, short) });
    }
  }
  return {
    entries,
    threads,
    environmentId: validId(raw.environmentId) && typeof raw.environmentId === "string" ? raw.environmentId.slice(0, 80) : null,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt.slice(0, 40) : null,
  };
}

/** "GPT-6.1 Sol · studio-mac": the bot's model and computer, from the feed. */
export function botMetaText(feed, key) {
  const entry = feed?.entries.get(threadIdFromKey(key));
  return entry ? [entry.model, entry.computer].filter(Boolean).join(" · ") : "";
}

/**
 * Loads the feed through the background worker, falling back to the cached
 * copy. load() resolves to the parsed feed or null.
 */
export function createBotFeed({ area, fetchRemote }) {
  // The text last read from or written to the cache: an unchanged poll is not written again.
  let cachedText = null;
  async function readCache() {
    const value = (await area.get(STORAGE_KEYS.botFeedCache))?.[STORAGE_KEYS.botFeedCache];
    if (typeof value?.text !== "string") return null;
    cachedText = value.text;
    return parseBotFeedText(value.text);
  }
  return {
    readCache,
    async load() {
      let response;
      try {
        response = await fetchRemote(BOT_FEED_ENDPOINT);
      } catch {
        response = null;
      }
      const parsed = response?.ok ? parseBotFeedText(response.text) : null;
      if (parsed) {
        if (response.text !== cachedText) {
          await area.set({ [STORAGE_KEYS.botFeedCache]: { text: response.text } });
          cachedText = response.text;
        }
        return parsed;
      }
      return readCache();
    },
  };
}
