// Minimal chrome.* stub so dist/content.js runs in a normal page for visual
// checks. Storage is backed by localStorage of the harness origin.
// Query parameters seed state for screenshots:
//   ?seed=<settings json>   t3plus.settings.v1
//   ?config=<t3plus.json>   served as the server file (otherwise: 404)
//   ?view=<json>            t3plus.profileView.v1
//   ?bots=<json>            t3plus.bots.v1
//   ?feed=<json>            served as t3plus-bots.json (otherwise: 404)
//   ?groupView=<json>       t3plus.assistantGroup.v1 (Assistant group open/closed)
//   ?localConfig=<json>     restored t3plus.config.local.v1
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
  const remoteTasks = params.has("tasks");
  const localConfig = params.get("localConfig");
  window.chrome = {
    runtime: {
      id: "t3plus-harness",
      lastError: undefined,
      getURL: (path) => `/dist/${path}`,
      // Stands in for the background worker. Answers both the callback and the promise form.
      sendMessage(message, callback) {
        const respond = (response) => new Promise((resolve) => setTimeout(() => { callback?.(response); resolve(response); }, 0));
        if (message.type === "t3plus/task-request") {
          const board = message.request?.method === "GET" && String(message.request.url).endsWith("/api/tasks/board");
          const text = board && remoteTasks ? JSON.stringify({
            today: [{ id: "demo-today", title: "Review the login redirect", status: "open", deadline_label: "Today", agent_hint: "Assistant" }],
            upcoming: [{ id: "demo-upcoming", title: "Prepare release notes", status: "waiting", waiting_reason: "Review" }],
            waiting: [],
          }) : null;
          return respond(text ? { ok: true, status: 200, text } : { ok: false, status: 401 });
        }
        if (message.type !== "t3plus/fetch-config") return respond({ ok: false, status: 404 });
        const url = String(message.url);
        if (url.endsWith("/t3plus-home.json")) {
          if (!remoteHome) return respond({ ok: false, status: 404 });
          return fetch("/harness/out/home-feed.json").then((r) => r.text()).then((text) => respond({ ok: true, status: 200, text }), () => respond({ ok: false, status: 0 }));
        }
        const text = url.endsWith("/t3plus-bots.json") ? remoteFeed : url.endsWith("/t3plus.json") ? remoteConfig : null;
        return respond(text ? { ok: true, status: 200, text } : { ok: false, status: 404 });
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
  const seeds = { seed: "t3plus.settings.v1", view: "t3plus.profileView.v1", bots: "t3plus.bots.v1", groupView: "t3plus.assistantGroup.v1" };
  for (const [param, key] of Object.entries(seeds)) {
    const value = params.get(param);
    if (value) localStorage.setItem(`stub:${key}`, value);
  }
  if (localConfig) localStorage.setItem("stub:t3plus.config.local.v1", localConfig);
})();
