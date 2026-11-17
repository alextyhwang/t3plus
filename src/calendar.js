import { CONFIG_LIMITS } from "./config.js";
import { RemoteFeedError, clean } from "./remoteFeed.js";

export const CALENDAR_PAGE = "https://calendar.google.com/calendar/u/0/r";
export const CALENDAR_STALE_MS = 24 * 60 * 60 * 1000;
function validTimeZone(value) {
  try { if (typeof value !== "string" || !value) return false; new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}
const dateOnly = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const instant = value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const dateInZone = (ms, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const hexColor = value => typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : null;

// The feed may resolve Google's event/label override itself, or include the
// colors.event palette with colorId. Never invent a color when it is absent.
function agendaColor(event, raw) {
  const paletteColor = typeof event.colorId === "string" ? raw.colors?.event?.[event.colorId]?.background : null;
  return hexColor(event.backgroundColor) || hexColor(paletteColor) ||
    hexColor(event.calendarColor) || hexColor(raw.backgroundColor);
}

/** Google-compatible expanded instances. No recurrence expansion or private detail retention in Chrome. */
export function normalizeAgenda(raw, now = Date.now()) {
  if (!raw || !Array.isArray(raw.items) || !validTimeZone(raw.timeZone)) throw new Error("Calendar returned an invalid agenda.");
  const updated = instant(raw.updatedAt);
  if (updated === null || updated > now + 5 * 60000) throw new Error("Calendar snapshot freshness is unavailable.");
  const timeZone = raw.timeZone, today = dateInZone(now, timeZone), horizon = dateInZone(now + 7 * 86400000, timeZone);
  const seen = new Set();
  const events = [];
  for (const event of raw.items.slice(0, 500)) {
    if (!event || event.status === "cancelled" || !clean(event.id) || seen.has(event.id)) continue;
    const allDay = dateOnly(event.start?.date) && dateOnly(event.end?.date);
    const start = allDay ? event.start.date : instant(event.start?.dateTime);
    const end = allDay ? event.end.date : instant(event.end?.dateTime);
    if (start === null || end === null || end <= start || (allDay ? end <= today : end <= now)) continue;
    // A recurring master is not an expanded occurrence.
    if (Array.isArray(event.recurrence) && !event.recurringEventId) continue;
    seen.add(event.id);
    const day = allDay ? start : dateInZone(start, timeZone);
    if (day > horizon) continue;
    const labelDate = new Date(`${day}T12:00:00Z`);
    const dateLabel = day === today ? "Today" : new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(labelDate);
    const clock = ms => new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(ms);
    const lastDay = allDay ? new Date(Date.parse(`${end}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : dateInZone(end, timeZone);
    const endDayLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${lastDay}T12:00:00Z`));
    events.push({ title: clean(event.summary) || "Busy", day, lastDay: allDay ? lastDay : dateInZone(end - 1, timeZone), color: agendaColor(event, raw), allDay, sort: allDay ? Date.parse(`${start}T00:00:00Z`) : start,
      when: `${dateLabel} · ${allDay ? `All day${lastDay > day ? ` · through ${endDayLabel}` : ""}` : `${clock(start)}–${lastDay !== day ? `${endDayLabel} ` : ""}${clock(end)}`}` });
  }
  events.sort((a,b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay) || a.sort - b.sort);
  return { timeZone, today, horizon, updated, stale: raw.stale === true || now - updated >= CALENDAR_STALE_MS, events: events.slice(0, 50) };
}

export class CalendarError extends RemoteFeedError {}

export function createCalendarFeed({ requestRemote, now = Date.now, signIn } = {}) {
  return { signIn, async load() {
    let response;
    try { response = await requestRemote(); } catch { throw new CalendarError("Connection unavailable. Try again."); }
    if (!response?.ok) throw new CalendarError(response?.status === 401 ? "Sign in to see your calendar." : response?.status === 503 ? "Calendar source needs setup." : "Could not refresh. Try again.", response?.status);
    if (typeof response.text !== "string" || response.text.length > CONFIG_LIMITS.maxChars) throw new CalendarError("Response is too large.");
    let raw;
    try { raw = JSON.parse(response.text); } catch { throw new CalendarError("Service returned invalid data."); }
    return normalizeAgenda(raw, now());
  } };
}
