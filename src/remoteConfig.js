import { BOT_MARKER_PATTERN, CONFIG_LIMITS, DEFAULT_BOT_MARKER, STORAGE_KEYS } from "./config.js";
import { CONFIG_ENDPOINTS } from "./hosts.js";
import { normalizeAccent, subscribeKey } from "./settings.js";

// Server-owned t3plus.json: profile definitions, project/thread memberships and
// the bot title marker. t3+ only READS this file. It is written by whoever owns
// the file share (see README "Profiles: t3plus.json and the control thread").
//
// Sources, in the order the provider tries them:
//   "remote"  the default endpoint (src/hosts.js), fetched by the background worker
//   "cache"   the last good remote copy, used (and labelled) when the fetch fails
//   "local"   a JSON override pasted in Settings, used only when the user picks it
//   "none"    nothing usable: only the "All" tab, plus a diagnostic saying why

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const THREAD_KEY = /^[^:\s]+:[^\s]+$/;

/** Config with no profiles: what t3+ shows when no source is usable. */
export function emptyConfig() {
  return { version: 1, botMarker: DEFAULT_BOT_MARKER, profiles: [], controlThread: null, updatedAt: null };
}

const uniqueStrings = (list, max, test = () => true) => {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value || value.length > 512 || !test(value) || out.includes(value)) continue;
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
};

/**
 * Validates parsed t3plus.json. Never throws. Invalid entries are dropped and
 * reported in `errors`, so one bad profile does not hide the others.
 * @returns {{ config: ReturnType<typeof emptyConfig>, errors: string[] }}
 */
export function normalizeT3PlusConfig(raw) {
  const errors = [];
  const config = emptyConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { config, errors: ["t3plus.json must be a JSON object."] };
  }
  if (raw.version !== 1) errors.push(`Unsupported "version" ${JSON.stringify(raw.version)}; expected 1. Reading it as version 1.`);

  if (raw.botMarker !== undefined) {
    if (typeof raw.botMarker === "string" && BOT_MARKER_PATTERN.test(raw.botMarker)) config.botMarker = raw.botMarker;
    else errors.push(`Ignored "botMarker": it must be one [[...]] token without spaces.`);
  }
  if (typeof raw.controlThread === "string" && THREAD_KEY.test(raw.controlThread)) config.controlThread = raw.controlThread;
  if (typeof raw.updatedAt === "string") config.updatedAt = raw.updatedAt.slice(0, 40);

  const profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  if (!Array.isArray(raw.profiles)) errors.push(`"profiles" must be an array.`);
  for (const [index, entry] of profiles.entries()) {
    if (config.profiles.length >= CONFIG_LIMITS.maxProfiles) {
      errors.push(`Only the first ${CONFIG_LIMITS.maxProfiles} profiles are used.`);
      break;
    }
    const where = `profiles[${index}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${where} is not an object.`);
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id.trim().toLowerCase() : "";
    if (!PROFILE_ID.test(id) || id === "all") {
      errors.push(`${where}: "id" must be 1-32 of a-z, 0-9, "-", "_" (and not "all").`);
      continue;
    }
    if (config.profiles.some((p) => p.id === id)) {
      errors.push(`${where}: duplicate id "${id}".`);
      continue;
    }
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim().slice(0, 24) : id;
    config.profiles.push({
      id,
      label,
      color: entry.color === undefined ? null : normalizeAccent(entry.color, null),
      includeAll: entry.includeAll === true,
      excludeProjects: uniqueStrings(entry.excludeProjects, CONFIG_LIMITS.maxProjectsPerProfile),
      projects: uniqueStrings(entry.projects, CONFIG_LIMITS.maxProjectsPerProfile),
      threads: uniqueStrings(entry.threads, CONFIG_LIMITS.maxThreadsPerProfile, (v) => THREAD_KEY.test(v)),
      showBots: entry.showBots !== false,
    });
  }
  return { config, errors };
}

/** Parses JSON text with size limits. @returns {{ config, errors, parsed: boolean }} */
export function parseT3PlusConfigText(text) {
  if (typeof text !== "string" || !text.trim()) return { config: emptyConfig(), errors: ["The file is empty."], parsed: false };
  if (text.length > CONFIG_LIMITS.maxChars) {
    return { config: emptyConfig(), errors: [`The file is larger than ${CONFIG_LIMITS.maxChars / 1024} KB.`], parsed: false };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { config: emptyConfig(), errors: [`Not valid JSON: ${error.message}`], parsed: false };
  }
  return { ...normalizeT3PlusConfig(raw), parsed: true };
}

/** Human-readable reason for a failed fetch result from the background worker. */
export function describeFetchFailure(result, url) {
  if (!result) return `No response from the t3+ background worker.`;
  if (result.error) return `Could not reach ${url}: ${result.error}`;
  if (result.status === 404) return `${url} returned 404: t3plus.json has not been published yet.`;
  return `${url} returned HTTP ${result.status}.`;
}

/**
 * Loads t3plus.json from the configured sources.
 *
 * deps: {
 *   area, changedEvent,                     chrome.storage.local (+ onChanged)
 *   fetchRemote(url) -> Promise<{ ok, status, text?, error? }>   background worker
 *   now?() -> ms
 *   endpoint?                                defaults to CONFIG_ENDPOINTS[0]
 * }
 *
 * load() resolves to { config, source, errors, diagnostic, fetchedAt, endpoint }.
 */
export function createConfigProvider(deps) {
  const { area, changedEvent, fetchRemote } = deps;
  const now = deps.now ?? (() => Date.now());
  const endpoint = deps.endpoint ?? CONFIG_ENDPOINTS[0];

  async function readLocal() {
    const value = (await area.get(STORAGE_KEYS.configLocal))?.[STORAGE_KEYS.configLocal];
    return {
      use: value?.use === "local" ? "local" : "remote",
      text: typeof value?.text === "string" ? value.text.slice(0, CONFIG_LIMITS.maxChars) : "",
      savedAt: Number(value?.savedAt) || null,
    };
  }

  async function readCache() {
    const value = (await area.get(STORAGE_KEYS.configCache))?.[STORAGE_KEYS.configCache];
    if (!value || typeof value.text !== "string" || value.url !== endpoint) return null;
    return { text: value.text, fetchedAt: Number(value.fetchedAt) || 0 };
  }

  const result = (source, parsed, extra = {}) => ({
    config: parsed.config,
    errors: parsed.errors,
    source,
    endpoint,
    diagnostic: null,
    fetchedAt: null,
    ...extra,
  });

  async function load({ refresh = true } = {}) {
    const local = await readLocal();
    if (local.use === "local") {
      const parsed = parseT3PlusConfigText(local.text);
      return result(parsed.parsed ? "local" : "none", parsed, {
        diagnostic: parsed.parsed ? "Using the local override saved in this browser, not the server file." : `Local override is unusable: ${parsed.errors[0]}`,
        fetchedAt: local.savedAt,
      });
    }

    const cache = await readCache();
    if (!refresh && cache) {
      return result("cache", parseT3PlusConfigText(cache.text), { fetchedAt: cache.fetchedAt });
    }

    let response;
    try {
      response = await fetchRemote(endpoint);
    } catch (error) {
      response = { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    if (response?.ok) {
      const parsed = parseT3PlusConfigText(response.text);
      if (parsed.parsed) {
        const fetchedAt = now();
        await area.set({ [STORAGE_KEYS.configCache]: { url: endpoint, text: response.text, fetchedAt } });
        return result("remote", parsed, { fetchedAt });
      }
      const failure = `${endpoint} is not a usable t3plus.json: ${parsed.errors[0]}`;
      if (cache) return result("cache", parseT3PlusConfigText(cache.text), { diagnostic: failure, fetchedAt: cache.fetchedAt });
      return result("none", parsed, { diagnostic: failure });
    }

    const failure = describeFetchFailure(response, endpoint);
    if (cache) {
      return result("cache", parseT3PlusConfigText(cache.text), {
        diagnostic: `${failure} Showing the copy fetched earlier.`,
        fetchedAt: cache.fetchedAt,
      });
    }
    return result("none", { config: emptyConfig(), errors: [] }, { diagnostic: failure });
  }

  return {
    endpoint,
    load,
    readLocal,
    /** Saves the local override text and/or which source to use. */
    async saveLocal(patch) {
      const current = await readLocal();
      const next = { ...current, ...patch, savedAt: now() };
      await area.set({ [STORAGE_KEYS.configLocal]: { use: next.use, text: String(next.text ?? ""), savedAt: next.savedAt } });
      return next;
    },
    isStale(loaded) {
      return loaded.source !== "local" && (!loaded.fetchedAt || now() - loaded.fetchedAt > CONFIG_LIMITS.staleAfterMs);
    },
    subscribeLocal(listener) {
      return subscribeKey(changedEvent, STORAGE_KEYS.configLocal, listener);
    },
  };
}

/** fetchRemote for the extension: asks the background worker, which holds the host permission. */
export function createRuntimeFetcher(runtime) {
  return (url) =>
    new Promise((resolve) => {
      try {
        runtime.sendMessage({ type: "t3plus/fetch-config", url }, (response) => {
          const lastError = runtime.lastError;
          resolve(lastError ? { ok: false, status: 0, error: lastError.message } : response);
        });
      } catch (error) {
        resolve({ ok: false, status: 0, error: error instanceof Error ? error.message : String(error) });
      }
    });
}
