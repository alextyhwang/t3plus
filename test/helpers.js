import { JSDOM } from "jsdom";
import { createT3Plus } from "../src/app.js";
import { createBotStore } from "../src/bots.js";
import { createImageStore } from "../src/imageStore.js";
import { createProfileViewStore } from "../src/profiles.js";
import { createConfigProvider } from "../src/remoteConfig.js";
import { createSettingsStore } from "../src/settings.js";

/**
 * In-memory stand-in for chrome.storage.local + chrome.storage.onChanged.
 * Values are JSON-cloned like the real API, and onChanged fires for every
 * listener, which models several T3 tabs sharing one extension.
 */
export function createFakeChromeStorage() {
  const data = new Map();
  const listeners = new Set();
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const emit = (changes) => {
    for (const listener of [...listeners]) listener(changes, "local");
  };
  const area = {
    data,
    // Like chrome.storage: one key or a list of keys.
    async get(key) {
      const out = {};
      for (const k of [].concat(key)) if (data.has(k)) out[k] = clone(data.get(k));
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: clone(data.get(key)), newValue: clone(value) };
        data.set(key, clone(value));
      }
      emit(changes);
    },
    async remove(key) {
      const changes = {};
      for (const k of [].concat(key)) {
        changes[k] = { oldValue: clone(data.get(k)), newValue: undefined };
        data.delete(k);
      }
      emit(changes);
    },
  };
  const onChanged = {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    listenerCount: () => listeners.size,
  };
  return { area, onChanged };
}

/** Minimal copy of the T3 DOM t3+ depends on (see src/config.js for sources). */
export const T3_APPEARANCE_HTML = `
  <div data-settings-page-scroll>
    <div id="page-container">
      <section id="appearance"><h2>Colors &amp; themes</h2></section>
      <section id="appearance-interface"><h2>Interface</h2></section>
    </div>
  </div>`;

export const T3_COMPOSER_HTML = `
  <div data-chat-composer-overlay="true">
    <div class="composer-main">
      <div data-chat-composer-surface="true" class="rounded-[20px]">
        <div data-chat-composer-body="true">
          <div data-testid="composer-editor" contenteditable="true"><p>hello</p></div>
        </div>
        <div data-chat-composer-footer="true"><button type="button">Send</button></div>
      </div>
    </div>
  </div>`;

export function createDom(path, bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`, {
    url: `https://app.t3.codes${path}`,
    pretendToBeVisual: true,
  });
  let counter = 0;
  dom.window.URL.createObjectURL = () => `blob:https://app.t3.codes/fake-${(counter += 1)}`;
  dom.window.URL.revokeObjectURL = () => {};
  return dom;
}

/** Lets MutationObserver callbacks and pending promise chains run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A fetchRemote stand-in. `fetchRemote.response` is what the background worker
 * would send: { ok, status, text } or { ok: false, status, error }. A plain
 * config object is served as JSON. Records the URLs asked for.
 */
export function createFakeRemote(response = { ok: false, status: 404 }) {
  const calls = [];
  const fetchRemote = async (url) => {
    calls.push(url);
    const current = fetchRemote.response;
    if (current && !("ok" in current)) return { ok: true, status: 200, text: JSON.stringify(current) };
    return current;
  };
  fetchRemote.response = response;
  fetchRemote.calls = calls;
  return fetchRemote;
}

export function createApp(dom, storage = createFakeChromeStorage(), extra = {}) {
  const { remote = createFakeRemote(), ...rest } = extra;
  const app = createT3Plus({
    win: dom.window,
    doc: dom.window.document,
    settingsStore: createSettingsStore(storage.area, storage.onChanged),
    imageStore: createImageStore(storage.area, storage.onChanged),
    profileViewStore: createProfileViewStore(storage.area, storage.onChanged),
    configProvider: createConfigProvider({ area: storage.area, changedEvent: storage.onChanged, fetchRemote: remote, now: () => 1_000_000 }),
    botStore: createBotStore(storage.area, storage.onChanged),
    assetUrl: (path) => `chrome-extension://t3plus-test/${path}`,
    throttleMs: 10_000, // tests drive checks with watcher.flush()
    ...rest,
  });
  return { app, storage, remote };
}

const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** One T3 thread row, shaped like SidebarThreadRow.tsx (folder/slim variant). */
export function threadRowHtml({ key, title, parent, status = null, project = null, current = false }) {
  const label = [title, status, project].filter(Boolean).join(", ");
  return `
      <li data-thread-item="${attr(key)}" class="list-none">
        <div role="button" tabindex="0" data-sidebar-row="${attr(key)}"${parent ? ` data-sidebar-parent="${attr(parent)}"` : ""}
             aria-label="${attr(label)}"${current ? ' aria-current="page"' : ""} data-testid="sidebar-row-folder">
          <div class="contents">
            <span class="sr-only">${attr(title)}</span>
            <span aria-hidden="true" dir="auto" class="truncate">${attr(title)}</span>
            <span class="flex shrink-0"><span role="status" class="sr-only">${attr(status ?? "")}</span></span>
          </div>
        </div>
      </li>`;
}

export const BOT_TITLE = "[[t3plus:bot:v1]] Orchestrator";

/**
 * A T3 sidebar (ui/sidebar.tsx + Sidebar.tsx): fixed header, then a scroll
 * area holding the row list. `folders: true` renders the project-grouped
 * ("Boring") layout with folder:<logicalProjectKey> headers; false is flat.
 */
export function sidebarHtml({ folders = true, currentKey = null } = {}) {
  const rows = [];
  const cur = (key) => key === currentKey;
  rows.push(threadRowHtml({ key: "env1:bot1", title: BOT_TITLE, status: "Working", project: "Ops", current: cur("env1:bot1") }));
  if (folders) {
    rows.push(`<li data-testid="sidebar-project-folder"><button type="button" data-sidebar-row="folder:github.com/acme/api">API</button></li>`);
    rows.push(threadRowHtml({ key: "env1:a1", title: "Fix login", parent: "folder:github.com/acme/api", status: "Done", current: cur("env1:a1") }));
    rows.push(threadRowHtml({ key: "env1:a2", title: "Add metrics", parent: "folder:github.com/acme/api", current: cur("env1:a2") }));
    rows.push(`<li data-testid="sidebar-project-folder"><button type="button" data-sidebar-row="folder:github.com/acme/web">Web</button></li>`);
    rows.push(threadRowHtml({ key: "env1:w1", title: "Landing page", parent: "folder:github.com/acme/web", current: cur("env1:w1") }));
    rows.push(`<li data-testid="sidebar-project-folder"><button type="button" data-sidebar-row="folder:/home/me/notes">notes</button></li>`);
    rows.push(threadRowHtml({ key: "env2:n1", title: "Weekly notes", parent: "folder:/home/me/notes", current: cur("env2:n1") }));
  } else {
    rows.push(threadRowHtml({ key: "env1:a1", title: "Fix login", status: "Done", project: "API", current: cur("env1:a1") }));
    rows.push(threadRowHtml({ key: "env1:w1", title: "Landing page", project: "Web", current: cur("env1:w1") }));
    rows.push(`<li><div data-sidebar-row="shelf:settled">Settled</div></li>`);
    rows.push(threadRowHtml({ key: "env2:n1", title: "Weekly notes", parent: "shelf:settled", project: "notes", current: cur("env2:n1") }));
  }
  return `
  <div data-slot="sidebar-container">
    <div data-sidebar="sidebar" data-slot="sidebar-inner">
      <div class="w-full shrink-0"><div data-slot="sidebar-group"><input type="search" aria-label="Search threads"></div></div>
      <div data-slot="scroll-area">
        <div data-slot="scroll-area-viewport">
          <div data-sidebar="content" data-slot="sidebar-content">
            <div data-slot="sidebar-group"><ul role="presentation" id="thread-list">${rows.join("")}
            </ul></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/** A server t3plus.json for tests. */
export const SAMPLE_CONFIG = {
  version: 1,
  profiles: [
    { id: "work", label: "Work", color: "#60a5fa", projects: ["github.com/acme/api", "github.com/acme/web"] },
    { id: "personal", label: "Personal", projects: ["/home/me/notes"], threads: ["env1:a2"] },
  ],
};

/** A tiny valid WebP-labelled data URL record, as prepareImageFile would return. */
export function fakeImageRecord(name = "photo.png") {
  return {
    dataUrl: `data:image/webp;base64,${Buffer.from("fake-webp-bytes").toString("base64")}`,
    name,
    width: 1600,
    height: 900,
    savedAt: 1,
  };
}
