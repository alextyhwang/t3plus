// Extension storage helpers shared by the t3+ stores (settings, profiles, bots,
// the Assistant group view, t3plus.json). Values live in one storage area
// (chrome.storage.local in the extension; a fake in tests), one key each.

/** Shared chrome.storage.onChanged filter for one key in the "local" area. Returns an unsubscribe. */
export function subscribeKey(changedEvent, key, listener) {
  if (!changedEvent) return () => {};
  const handler = (changes, areaName) => {
    if (areaName !== "local" || !(key in changes)) return;
    listener(changes[key].newValue);
  };
  changedEvent.addListener(handler);
  return () => changedEvent.removeListener(handler);
}

/**
 * One value under one storage key, always passed through `normalize`: what
 * load() reads, what save() writes (and returns), and what subscribe() reports
 * when another tab or this one saves.
 */
export function createKeyStore(area, changedEvent, key, normalize) {
  return {
    async load() {
      return normalize((await area.get(key))?.[key]);
    },
    async save(value) {
      const normalized = normalize(value);
      await area.set({ [key]: normalized });
      return normalized;
    },
    subscribe(listener) {
      return subscribeKey(changedEvent, key, (value) => listener(normalize(value)));
    },
  };
}
