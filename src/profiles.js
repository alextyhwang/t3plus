import { NON_THREAD_ROUTE_SEGMENTS, STORAGE_KEYS } from "./config.js";
import { subscribeKey } from "./settings.js";

// Profile viewing state: which tab is active and the last thread opened under
// each tab. Viewing choices only, kept in chrome.storage.local (approved by the
// user). Profile definitions come from t3plus.json (remoteConfig.js).

export const ALL_PROFILE_ID = "all";

/** "/<environmentId>/<threadId>" -> "<environmentId>:<threadId>", else null. */
export function threadKeyFromPath(pathname) {
  const parts = String(pathname ?? "").split("/").filter(Boolean);
  if (parts.length !== 2 || NON_THREAD_ROUTE_SEGMENTS.includes(parts[0])) return null;
  try {
    const [environmentId, threadId] = parts.map(decodeURIComponent);
    return environmentId && threadId ? `${environmentId}:${threadId}` : null;
  } catch {
    return null;
  }
}

export function normalizeProfileView(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const lastThreadByProfile = {};
  if (value.lastThreadByProfile && typeof value.lastThreadByProfile === "object") {
    for (const [id, key] of Object.entries(value.lastThreadByProfile)) {
      if (typeof key === "string" && key.includes(":") && key.length < 300) lastThreadByProfile[id] = key;
    }
  }
  return {
    activeProfileId: typeof value.activeProfileId === "string" && value.activeProfileId ? value.activeProfileId : ALL_PROFILE_ID,
    lastThreadByProfile,
  };
}

/** The active profile object, or null for "All" (also when the id no longer exists). */
export function resolveActiveProfile(config, view) {
  if (view.activeProfileId === ALL_PROFILE_ID) return null;
  return config.profiles.find((p) => p.id === view.activeProfileId) ?? null;
}

/**
 * Where to go when switching to `profileId`. Returns a thread key to open, or
 * null to stay on the current page:
 * - "All", or the open thread already belongs to the profile: stay.
 * - The profile's last thread is still in the sidebar: go there.
 * - Otherwise stay (the open thread remains visible as "outside").
 */
export function threadToRestore({ profileId, view, currentThreadKey, isMember, isAvailable }) {
  if (profileId === ALL_PROFILE_ID) return null;
  if (currentThreadKey && isMember(currentThreadKey)) return null;
  const last = view.lastThreadByProfile[profileId];
  if (!last || last === currentThreadKey || !isAvailable(last)) return null;
  return last;
}

export function createProfileViewStore(area, changedEvent) {
  const key = STORAGE_KEYS.profileView;
  return {
    async load() {
      return normalizeProfileView((await area.get(key))?.[key]);
    },
    async save(view) {
      const normalized = normalizeProfileView(view);
      await area.set({ [key]: normalized });
      return normalized;
    },
    subscribe(listener) {
      return subscribeKey(changedEvent, key, (value) => listener(normalizeProfileView(value)));
    },
  };
}
