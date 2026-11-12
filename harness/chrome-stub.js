// Minimal chrome.* stub so dist/content.js runs in a normal page for visual
// checks. Storage is backed by localStorage of the harness origin.
// Query parameters seed state for screenshots:
//   ?seed=<settings json>   t3plus.settings.v1
//   ?config=<t3plus.json>   served as the server file (otherwise: 404)
//   ?view=<json>            t3plus.profileView.v1
//   ?bots=<json>            t3plus.bots.v1
//   ?feed=<json>            served as t3plus-bots.json (otherwise: 404)
(() => {
  const listeners = new Set();
  const read = (key) => {
    const raw = localStorage.getItem(`stub:${key}`);
    return raw === null ? undefined : JSON.parse(raw);
  };
  const emit = (changes) => {
    for (const listener of listeners) listener(changes, "local");
  };
  const params = new URLSearchParams(location.search);
  const remoteConfig = params.get("config");
  const remoteFeed = params.get("feed");
  const remoteHome = params.get("home");
  window.chrome = {
    runtime: {
      id: "t3plus-harness",
      lastError: undefined,
      getURL: (path) => `/dist/${path}`,
      // Stands in for the background worker's t3plus.json fetch.
      sendMessage(message, callback) {
        const url = String(message.url);
        if (url.endsWith("/t3plus-home.json")) {
          if (!remoteHome) return setTimeout(() => callback({ ok: false, status: 404 }), 0);
          fetch("/harness/out/home-feed.json").then((r) => r.text()).then((text) => callback({ ok: true, status: 200, text }), () => callback({ ok: false, status: 0 }));
          return;
        }
        const text = url.endsWith("/t3plus-bots.json") ? remoteFeed : remoteConfig;
        const response = text ? { ok: true, status: 200, text } : { ok: false, status: 404 };
        setTimeout(() => callback(response), 0);
      },
    },
    storage: {
      local: {
        async get(key) {
          const value = read(key);
          return value === undefined ? {} : { [key]: value };
        },
        async set(items) {
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: read(key), newValue: value };
            localStorage.setItem(`stub:${key}`, JSON.stringify(value));
          }
          emit(changes);
        },
        async remove(key) {
          const changes = { [key]: { oldValue: read(key), newValue: undefined } };
          localStorage.removeItem(`stub:${key}`);
          emit(changes);
        },
      },
      onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    },
  };
  const seeds = { seed: "t3plus.settings.v1", view: "t3plus.profileView.v1", bots: "t3plus.bots.v1" };
  for (const [param, key] of Object.entries(seeds)) {
    const value = params.get(param);
    if (value) localStorage.setItem(`stub:${key}`, value);
  }
})();
