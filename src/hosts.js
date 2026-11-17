// Every URL t3+ requests, derived from src/personal.js. The background worker
// fetches only these; manifest.json must grant their origins (checked by
// test/manifest.test.js). An empty base leaves its endpoints empty, and t3+
// makes no request for them.
import { FEED_BASE, IMMICH, TASKS_BASE } from "./personal.js";

const under = (base, path) => (base ? `${base}${path}` : "");

/** Read-only, server-owned feeds. A plain file share sends no CORS headers, so the worker fetches them. */
export const CONFIG_ENDPOINT = under(FEED_BASE, "t3plus.json");
export const BOT_FEED_ENDPOINT = under(FEED_BASE, "t3plus-bots.json");
export const HOME_FEED_ENDPOINT = under(FEED_BASE, "t3plus-home.json");

export const TASKS_API_ENDPOINT = under(TASKS_BASE, "api/tasks");
export const TASKS_BOARD_ENDPOINT = under(TASKS_BASE, "api/tasks/board");
export const TASKS_SESSION_ENDPOINT = under(TASKS_BASE, "api/tasks/session");
export const TASKS_PAGE_ENDPOINT = under(TASKS_BASE, "tasks");
export const CALENDAR_AGENDA_ENDPOINT = under(TASKS_BASE, "api/tasks/calendar/agenda");

/** The anonymous feeds the worker's fetch bridge serves. Task, calendar and photo calls have their own bridges. */
export const FETCH_ENDPOINTS = Object.freeze([CONFIG_ENDPOINT, BOT_FEED_ENDPOINT, HOME_FEED_ENDPOINT, IMMICH.feedEndpoint].filter(Boolean));
