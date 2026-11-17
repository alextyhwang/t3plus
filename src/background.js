// t3+ background service worker. It makes every network request for the
// content script: a plain file share sends no CORS headers, the hosted T3 page
// cannot reach the tailnet under Chrome's Local Network Access policy, and the
// task and calendar APIs need the task site's HttpOnly session cookie.
//
// Messages choose what to fetch, never a free URL: feeds come from
// FETCH_ENDPOINTS, task calls must match tasks.js isTaskRoute, photos must be
// Immich thumbnails. Unset endpoints (src/personal.js) are refused. No
// redirects are followed and responses are capped at CONFIG_LIMITS.maxChars.
import { CONFIG_LIMITS } from "./config.js";
import { CALENDAR_AGENDA_ENDPOINT, FETCH_ENDPOINTS, TASKS_PAGE_ENDPOINT } from "./hosts.js";
import { IMMICH_IMAGE_MAX_BYTES, IMMICH_IMAGE_TYPES, isImmichThumbnail } from "./immich.js";
import { IMMICH, T3_ORIGIN } from "./personal.js";
import { isTaskRoute } from "./tasks.js";

const failure = (error) => ({ ok: false, status: 0, error: error instanceof Error ? error.message : String(error) });

/** The response body, or a failure when it exceeds CONFIG_LIMITS.maxChars. */
async function readCapped(response) {
  const text = await response.text();
  if (text.length > CONFIG_LIMITS.maxChars) return { ok: false, status: response.status, error: "Response is too large." };
  return { ok: response.ok, status: response.status, text };
}

export function isT3Sender(sender) {
  try { return sender?.frameId === 0 && new URL(sender.url).origin === T3_ORIGIN; } catch { return false; }
}

/** The calendar agenda, with the task site's session cookie. */
export async function fetchCalendar(fetchImpl = fetch) {
  if (!CALENDAR_AGENDA_ENDPOINT) return { ok: false, status: 0, error: "Calendar is not configured." };
  try {
    const response = await fetchImpl(CALENDAR_AGENDA_ENDPOINT, { method: "GET", credentials: "include", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { ok: false, status: response.status };
    const result = await readCapped(response);
    return result.ok ? result : { ok: false, status: 0 };
  } catch { return { ok: false, status: 0 }; }
}

/** One anonymous read-only feed from FETCH_ENDPOINTS. */
export async function fetchConfig(url, fetchImpl = fetch) {
  if (!FETCH_ENDPOINTS.includes(url)) return { ok: false, status: 0, error: "URL is not a configured t3+ endpoint." };
  try {
    const response = await fetchImpl(url, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) return { ok: false, status: response.status };
    return await readCapped(response);
  } catch (error) {
    return failure(error);
  }
}

/** Fetches one private thumbnail through the worker; the key never reaches the extension. */
export async function fetchImmichImage({ url } = {}, fetchImpl = fetch, imageEndpoint = IMMICH.imageEndpoint) {
  if (typeof url !== "string" || !isImmichThumbnail(url, imageEndpoint)) return { ok: false, status: 0, error: "Immich image URL is not allowlisted." };
  try {
    const response = await fetchImpl(url, { method: "GET", cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) return { ok: false, status: response.status };
    const blob = await response.blob();
    if (blob.size > IMMICH_IMAGE_MAX_BYTES || !IMMICH_IMAGE_TYPES.test(blob.type)) return { ok: false, status: response.status, error: "Invalid photo preview." };
    // Chrome runtime messages use JSON serialization; a Blob would become {}.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { ok: true, status: response.status, base64: btoa(binary), mimeType: blob.type };
  } catch (error) { return failure(error); }
}

/**
 * One task API call with the task site's session cookie. The content script
 * cannot carry the HttpOnly cookie itself, so this is the only bridge, and
 * tasks.js isTaskRoute bounds what it reaches.
 */
export async function fetchTaskRequest({ url, method = "GET", body, csrf } = {}, fetchImpl = fetch) {
  if (typeof url !== "string" || typeof method !== "string") return { ok: false, status: 0, error: "Invalid task request." };
  const verb = method.toUpperCase();
  if (!isTaskRoute(url, verb) || (verb === "GET" && (body !== undefined || csrf !== undefined))) return { ok: false, status: 0, error: "Task request is not allowlisted." };
  try {
    const headers = { Accept: "application/json" };
    const init = { method: verb, cache: "no-store", credentials: "include", redirect: "error", headers };
    if (verb === "POST") {
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof csrf !== "string" || !csrf || csrf.length > 256) return { ok: false, status: 0, error: "Task body or CSRF is missing." };
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = csrf;
      init.body = JSON.stringify({ ...body, csrf });
      if (init.body.length > 32768) return { ok: false, status: 0, error: "Task body is too large." };
    }
    return await readCapped(await fetchImpl(url, init));
  } catch (error) {
    return failure(error);
  }
}

/** Open the task site's own passkey UI. Message payloads cannot choose a URL,
 * and neither the extension nor T3 handles passkey material. */
export async function openTasksSignIn(sender, { windows, page = TASKS_PAGE_ENDPOINT } = {}) {
  try {
    if (!isT3Sender(sender) || !page) return { ok: false };
    await windows.create({ url: page, type: "popup", width: 480, height: 640, focused: true });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not open task sign-in." };
  }
}

/** Requests the content script may make, by message type. */
const handlers = {
  "t3plus/fetch-config": (message) => fetchConfig(message.url),
  "t3plus/calendar": () => fetchCalendar(),
  "t3plus/task-request": (message) => fetchTaskRequest(message.request),
  "t3plus/tasks-signin": (_message, sender) => openTasksSignIn(sender, { windows: chrome.windows }),
  "t3plus/immich-image": (message) => fetchImmichImage(message.request),
};

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !Object.hasOwn(handlers, message?.type)) return false;
    if (!isT3Sender(sender)) {
      sendResponse({ ok: false, status: 403, error: "Requests are only accepted from T3." });
      return false;
    }
    handlers[message.type](message, sender).then(sendResponse);
    return true;
  });
}

// The toolbar icon opens T3's Settings on the t3+ section (#t3plus, read by src/app.js).
if (typeof chrome !== "undefined" && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: `${T3_ORIGIN}/settings/appearance#t3plus` }));
}
