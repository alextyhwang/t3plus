import { createBuilder } from "./dom.js";
import { formatImmichUptime } from "./immich.js";

/** The feed refreshes on a new draft and then every REFRESH_MS while it stays on screen. */
const REFRESH_MS = 5 * 60 * 1000;

function photoDate(photo) {
  if (!photo?.date) return "Date unavailable";
  try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(photo.date)); } catch { return "Date unavailable"; }
}

function statusLabel(status, phase = "idle") {
  if (status?.state === "offline") return "Offline";
  if (status?.state === "degraded") return "Degraded";
  if (status?.state === "stale") return "Stale service data";
  if (phase === "loading") return "Checking";
  if (phase === "error") return "Offline";
  return "Online";
}

/** `now` is the clock for refresh timing; `wallNow` the wall clock for uptime. */
export function createImmichView(doc, { feed, schedule = () => {}, now = Date.now, wallNow = Date.now } = {}) {
  const h = createBuilder(doc);
  const element = h("section", { class: "t3plus-immich", "data-t3plus-owned": "", "aria-label": "Family photo library" });
  let epoch = 0;
  let currentKey = null;
  let lastFetch = -Infinity;
  let state = { phase: "idle", feed: null, error: "" };
  const objectUrls = new Map();
  const urlApi = doc.defaultView?.URL ?? globalThis.URL;
  let signature = "";

  function revokeImages() {
    for (const url of objectUrls.values()) {
      try { urlApi?.revokeObjectURL?.(url); } catch { /* browser teardown */ }
    }
    objectUrls.clear();
  }

  function reset() {
    epoch += 1; currentKey = null; lastFetch = -Infinity; state = { phase: "idle", feed: null, error: "" }; signature = "";
    revokeImages(); element.replaceChildren(); element.remove();
  }

  function render() {
    const nextSignature = JSON.stringify({ phase: state.phase, feed: state.feed, error: state.error, images: [...objectUrls.entries()] });
    if (nextSignature === signature && element.isConnected) return;
    signature = nextSignature;
    element.replaceChildren();
    const feedValue = state.feed;
    const status = feedValue?.status;
    const statusClass = status?.state === "online" ? "online" : status?.state || (state.phase === "error" ? "offline" : state.phase === "loading" ? "degraded" : "unknown");
    const title = h("div", { class: "t3plus-immich-head" }, [
      h("h3", { text: "Family photos" }),
      h("a", { class: "t3plus-immich-link", href: feedValue?.libraryUrl || feed?.libraryUrl || "#", target: "_blank", rel: "noopener noreferrer", text: "Open library" }),
    ]);
    element.append(title);
    if (state.error) element.append(h("p", { class: "t3plus-immich-message", role: "status", text: state.error }));
    if (state.phase === "loading" && !feedValue) element.append(h("p", { class: "t3plus-immich-message", role: "status", text: "Loading recent photos…" }));
    if (state.phase === "error" && !feedValue && !state.error) element.append(h("p", { class: "t3plus-immich-message", role: "status", text: "Recent photos are unavailable." }));
    if (feedValue?.photos?.length) {
      const grid = h("div", { class: "t3plus-immich-grid", "aria-label": "Recent photos" });
      for (const [index, photo] of feedValue.photos.entries()) {
        const media = h("span", { class: "t3plus-immich-thumb" });
        const url = objectUrls.get(photo.id);
        if (url) media.append(h("img", { src: url, alt: `Recent family photo ${index + 1}`, loading: "eager", decoding: "async" }));
        else media.append(h("span", { class: "t3plus-immich-thumb-placeholder", "aria-hidden": "true" }));
        const link = h("a", { class: "t3plus-immich-photo", href: photo.link || feedValue.libraryUrl, target: "_blank", rel: "noopener noreferrer", "aria-label": `${photoDate(photo)}` }, [media, h("span", { class: "t3plus-immich-photo-date", text: photoDate(photo) })]);
        grid.append(link);
      }
      element.append(grid);
    } else if (state.phase !== "loading" && !state.error) element.append(h("p", { class: "t3plus-immich-message", text: "No recent photos." }));
    if (feedValue?.status || state.phase !== "idle") {
      const statusText = status
        ? [statusLabel(status, state.phase), formatImmichUptime(status, wallNow), status?.version ? `v${status.version}` : ""].filter(Boolean).join(" · ")
        : state.phase === "loading" ? "Checking service…" : "Offline · Uptime unavailable";
      element.append(h("p", { class: `t3plus-immich-status t3plus-immich-status-${statusClass}`, role: "status", text: statusText }));
    }
  }

  async function load(key, valid) {
    const started = ++epoch;
    state = { ...state, phase: "loading", error: "" }; render();
    try {
      const value = await feed.load();
      if (started !== epoch || currentKey !== key || !valid()) return;
      revokeImages();
      state = { phase: "ready", feed: value, error: "" }; render();
      await Promise.all(value.photos.map(async (photo) => {
        try {
          const blob = await feed.image(photo.thumbnailUrl);
          if (started !== epoch || currentKey !== key || !valid()) return;
          const url = urlApi?.createObjectURL?.(blob);
          if (!url) return;
          objectUrls.set(photo.id, url);
        } catch { /* retain a stable placeholder for one missing image */ }
      }));
      if (started === epoch && currentKey === key && valid()) { render(); schedule(); }
    } catch (error) {
      if (started !== epoch || currentKey !== key || !valid()) return;
      state = { phase: "error", feed: null, error: error?.message || "Could not load recent photos." }; render();
    }
  }

  function sync({ key, host, valid = () => true } = {}) {
    if (!key || !host) { reset(); return; }
    const changed = currentKey !== key;
    if (changed) { revokeImages(); state = { phase: "idle", feed: null, error: "" }; signature = ""; }
    currentKey = key;
    if (element.parentElement !== host) host.append(element);
    if (state.phase === "idle" || now() - lastFetch >= REFRESH_MS) { lastFetch = now(); load(key, valid); }
    render();
  }

  return { element, sync, reset, destroy() { reset(); revokeImages(); } };
}

