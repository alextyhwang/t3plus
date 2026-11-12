import { BOT_LIMITS, CONFIG_LIMITS, STORAGE_KEYS } from "./config.js";
import { BOT_FEED_ENDPOINT } from "./hosts.js";

// t3plus-bots.json: the latest message of each bot thread, published by
// server/publish_bot_feed.py (read-only on T3's database). Format v1:
//   { version: 1, generatedAt, environmentId,
//     bots: { "<threadId>": { text, role, at, model?, effort?, computer? } } }
// Keyed by thread id (the part of the sidebar key after "<environmentId>:").

/** @returns {{ entries: Map<string, { text, role, at }>, generatedAt: string | null } | null} */
export function parseBotFeedText(text) {
  if (typeof text !== "string" || !text.trim() || text.length > CONFIG_LIMITS.maxChars) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !raw.bots || typeof raw.bots !== "object") return null;
  const entries = new Map();
  for (const [threadId, entry] of Object.entries(raw.bots).slice(0, BOT_LIMITS.maxBots * 2)) {
    if (!entry || typeof entry !== "object" || !threadId || /\s/.test(threadId)) continue;
    const short = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const clean = short(entry.text, BOT_LIMITS.maxPreviewChars);
    const model = short(entry.model, 32);
    const computer = short(entry.computer, 32);
    if (!clean && !model && !computer) continue;
    entries.set(threadId, {
      text: clean,
      role: entry.role === "user" ? "user" : "assistant",
      at: typeof entry.at === "string" ? entry.at.slice(0, 40) : null,
      model,
      computer,
    });
  }
  return { entries, generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt.slice(0, 40) : null };
}

/** Thread id from a sidebar key "<environmentId>:<threadId>" (thread ids may contain ":"). */
export const threadIdFromKey = (key) => {
  const i = String(key).indexOf(":");
  return i < 0 ? String(key) : String(key).slice(i + 1);
};

/** Preview line for a bot row: "You: …" for the user's own last message. */
export function botPreviewText(feed, key) {
  const entry = feed?.entries.get(threadIdFromKey(key));
  if (!entry?.text) return feed ? "No messages yet" : "";
  return entry.role === "user" ? `You: ${entry.text}` : entry.text;
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
export function createBotFeed({ area, fetchRemote, endpoint = BOT_FEED_ENDPOINT }) {
  async function readCache() {
    const value = (await area.get(STORAGE_KEYS.botFeedCache))?.[STORAGE_KEYS.botFeedCache];
    return typeof value?.text === "string" ? parseBotFeedText(value.text) : null;
  }
  return {
    endpoint,
    readCache,
    async load() {
      let response;
      try {
        response = await fetchRemote(endpoint);
      } catch {
        response = null;
      }
      const parsed = response?.ok ? parseBotFeedText(response.text) : null;
      if (parsed) {
        await area.set({ [STORAGE_KEYS.botFeedCache]: { text: response.text } });
        return parsed;
      }
      return readCache();
    },
  };
}
