// t3+ background service worker. Its main job: fetch the read-only feeds
// (t3plus.json, t3plus-bots.json, t3plus-home.json) for content scripts, because
// a plain file share sends no CORS headers and a content script fetch would be blocked.
//
// It fetches only URLs listed in src/hosts.js FETCH_ENDPOINTS (which are also
// the manifest's only host permissions), sends no cookies, follows no
// redirects, and returns at most CONFIG_LIMITS.maxChars characters.
import { CONFIG_LIMITS } from "./config.js";
import { FEEDS_CONFIGURED, FETCH_ENDPOINTS } from "./hosts.js";

export async function fetchConfig(url, fetchImpl = fetch) {
  if (!FETCH_ENDPOINTS.includes(url)) return { ok: false, status: 0, error: "URL is not a configured t3+ endpoint." };
  try {
    const response = await fetchImpl(url, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) return { ok: false, status: response.status };
    const text = await response.text();
    if (text.length > CONFIG_LIMITS.maxChars) return { ok: false, status: response.status, error: "Response is too large." };
    return { ok: true, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "t3plus/fetch-config") return false;
    // Built without a feed folder (see README, "Feeds"): nothing to fetch.
    if (!FEEDS_CONFIGURED) {
      sendResponse({ ok: false, status: 0, error: "No feed folder is set for this build." });
      return false;
    }
    fetchConfig(message.url).then(sendResponse);
    return true; // keeps the channel open for the async response
  });
}

// The toolbar icon opens T3's Settings on the t3+ section (#t3plus, read by
// src/app.js). chrome.tabs.create needs no extra permission.
export const SETTINGS_URL = "https://app.t3.codes/settings/appearance#t3plus";
if (typeof chrome !== "undefined" && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: SETTINGS_URL }));
}
