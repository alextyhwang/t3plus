import { STORAGE_KEYS } from "./config.js";
import { createKeyStore } from "./storage.js";
import { THREAD_KEY } from "./threadKey.js";

// Profile viewing state: which tab is active and the last thread opened under
// each tab. Viewing choices only, kept in chrome.storage.local (approved by the
// user). Profile definitions come from t3plus.json (remoteConfig.js).

export const ALL_PROFILE_ID = "all";

export function normalizeProfileView(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const lastThreadByProfile = {};
  if (value.lastThreadByProfile && typeof value.lastThreadByProfile === "object") {
    for (const [id, key] of Object.entries(value.lastThreadByProfile)) {
      if (typeof key === "string" && THREAD_KEY.test(key) && key.length < 300) lastThreadByProfile[id] = key;
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
  return createKeyStore(area, changedEvent, STORAGE_KEYS.profileView, normalizeProfileView);
}
