import { T3_DRAFTS_STORAGE_KEY, T3_SELECTORS, T3PLUS } from "./config.js";
import { createCalendarCard } from "./calendarWidgets.js";
import { createImmichView } from "./immichWidgets.js";
import { createTasksPanel } from "./taskWidgets.js";

const POLL_MS = 60 * 1000;
/** Attributes that open, close or retarget T3's details card; the DOM watcher reacts to them. */
export const DRAFT_DETAILS_ATTRIBUTES = Object.freeze(["hidden", "aria-hidden", "data-state", "data-closed", "data-workspace-focus-key", "data-project-id", "data-project-key"]);

/** T3 gives /draft/<key> a separate pending thread id. Read the current
 * draft's exact identity, never the last-used project or a project label.
 * No composer content is retained, copied, or written by this integration. */
export function readDraftIdentity(win, doc) {
  const match = /^\/draft\/([^/]+)\/?$/.exec(win.location.pathname);
  if (!match || !doc.querySelector(T3_SELECTORS.draftProjectTrigger)) return null;
  try {
    const key = decodeURIComponent(match[1]);
    const draft = JSON.parse(win.localStorage.getItem(T3_DRAFTS_STORAGE_KEY))?.state?.draftThreadsByThreadKey?.[key];
    if (!draft || draft.promotedTo || ![draft.environmentId, draft.projectId, draft.threadId].every(value => typeof value === "string" && value.trim())) return null;
    return { environmentId: draft.environmentId, projectId: draft.projectId, threadId: draft.threadId, draftKey: key };
  } catch {
    return null;
  }
}

const draftKey = (draft) => `${draft.environmentId}:${draft.projectId}:${draft.threadId}:${draft.draftKey}`;

/**
 * t3+'s widgets inside the Thread Details card of a new-thread draft: tasks
 * and the calendar in the Assistant project, recent photos in the Immich
 * project. Saved conversations keep their native details untouched.
 *
 * assistant: { projectId, environmentId() } (the environment comes from the
 * bot feed); immich: { projectId, environmentId } (src/personal.js IMMICH).
 * homeRect() is the home grid's box, which the tasks column ends at.
 */
export function createDraftDetails({ win, doc, schedule, now, feeds, assistant, immich: immichProject, homeRect }) {
  const tasks = createTasksPanel(doc, { feed: feeds.tasks, schedule, now });
  const calendar = createCalendarCard(doc, { feed: feeds.calendar, schedule, now });
  const immich = createImmichView(doc, { feed: feeds.immich, schedule, now });

  const isAssistant = (draft) => Boolean(feeds.tasks) && draft.environmentId === assistant.environmentId() && draft.projectId === assistant.projectId;
  const isImmich = (draft) => draft.environmentId === immichProject?.environmentId && draft.projectId === immichProject.projectId;
  const currentDraft = (matches) => {
    const draft = readDraftIdentity(win, doc);
    return draft && matches(draft) ? draft : null;
  };

  function activeCard(draft) {
    if (!draft) return null;
    const routeKey = `${draft.environmentId}:${draft.threadId}`;
    return [...doc.querySelectorAll(T3_SELECTORS.threadDetailsCard)].find((card) => {
      if (card.closest('[hidden], [aria-hidden="true"], [data-state="closed"], [data-closed]')) return false;
      const focusKey = card.closest("[data-workspace-focus-key]")?.getAttribute("data-workspace-focus-key");
      return !focusKey || focusKey === `details:${routeKey}`;
    }) ?? null;
  }

  function contentHost(card) {
    const viewport = card?.querySelector('[data-slot="scroll-area-viewport"], [data-radix-scroll-area-viewport]');
    const measured = viewport?.firstElementChild;
    if (measured) return measured;
    // Older T3 builds may omit the viewport hook: use the card's inner wrapper.
    // Task visibility must not depend on Usage limits being enabled.
    const first = card?.firstElementChild;
    return first?.firstElementChild ?? first ?? null;
  }

  /** Same draft, same card and host: a late response may still paint. */
  const stillShowing = (matches, key, card, host) => () => {
    const draft = currentDraft(matches);
    return Boolean(draft && draftKey(draft) === key && activeCard(draft) === card && contentHost(card) === host);
  };

  function clearLayout(card = null, host = null) {
    for (const old of doc.querySelectorAll(`[${T3PLUS.detailsTasksLayoutAttr}]`)) if (old !== card) {
      old.removeAttribute(T3PLUS.detailsTasksLayoutAttr);
      old.style.removeProperty("--t3plus-tasks-height");
    }
    for (const old of doc.querySelectorAll(`[${T3PLUS.detailsTasksHostAttr}]`)) if (old !== host) old.removeAttribute(T3PLUS.detailsTasksHostAttr);
  }

  function layOut(card, host) {
    clearLayout(card, host);
    if (!card.hasAttribute(T3PLUS.detailsTasksLayoutAttr)) card.setAttribute(T3PLUS.detailsTasksLayoutAttr, "");
    if (!host.hasAttribute(T3PLUS.detailsTasksHostAttr)) host.setAttribute(T3PLUS.detailsTasksHostAttr, "");
    // The draft's details end at the home grid's bottom. Without a grid, use
    // three quarters of the viewport, still capped by T3's own max-height.
    const home = homeRect();
    const top = card.getBoundingClientRect().top;
    const height = home?.height > 0 && home.bottom > top ? `${Math.round(home.bottom - top)}px` : "75dvh";
    if (card.style.getPropertyValue("--t3plus-tasks-height") !== height) card.style.setProperty("--t3plus-tasks-height", height);
  }

  function syncAssistant() {
    const draft = currentDraft(isAssistant);
    const card = activeCard(draft);
    const host = contentHost(card);
    if (!card || !host) {
      tasks.sync(null);
      clearLayout();
      calendar.reset();
      return;
    }
    const key = draftKey(draft);
    layOut(card, host);
    tasks.sync({ key, host, valid: () => {
      const current = currentDraft(isAssistant);
      return Boolean(current && activeCard(current) && draftKey(current) === key);
    } });
    calendar.sync({ key, host, before: tasks.element.parentElement === host ? tasks.element : null, valid: stillShowing(isAssistant, key, card, host) });
  }

  function syncImmich() {
    const draft = currentDraft(isImmich);
    const card = activeCard(draft);
    const host = contentHost(card);
    if (!card || !host) { immich.reset(); return; }
    const key = draftKey(draft);
    immich.sync({ key, host, valid: stillShowing(isImmich, key, card, host) });
  }

  const shown = () => tasks.element.isConnected || calendar.element.isConnected || immich.element.isConnected;
  const onFocus = () => { tasks.focus(); calendar.focus(); schedule(); };
  const onStorage = (event) => { if (event.key === T3_DRAFTS_STORAGE_KEY) schedule(); };
  let timer = null;

  return {
    sync() {
      syncAssistant();
      syncImmich();
    },
    start() {
      // Passkeys run on the task site's origin in a small window; returning
      // to T3 retries a 401 at once, without a page reload or copied auth.
      win.addEventListener("focus", onFocus);
      win.addEventListener("storage", onStorage);
      timer = win.setInterval(() => { if (doc.visibilityState !== "hidden" && shown()) schedule(); }, POLL_MS);
    },
    stop() {
      win.removeEventListener("focus", onFocus);
      win.removeEventListener("storage", onStorage);
      win.clearInterval(timer);
      tasks.destroy();
      immich.destroy();
      calendar.destroy();
      clearLayout();
    },
  };
}
