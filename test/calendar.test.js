import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAgenda, createCalendarFeed, CalendarError, CALENDAR_STALE_MS } from "../src/calendar.js";
import { fetchCalendar, isT3Sender } from "../src/background.js";
import { CALENDAR_AGENDA_ENDPOINT } from "../src/hosts.js";
import { isTaskRoute } from "../src/tasks.js";
import { createApp, createDom, settle } from "./helpers.js";
import { createCalendarCard } from "../src/calendarWidgets.js";

const now = Date.parse("2026-11-01T05:30:00Z");
const event = (id, start, end, extra = {}) => ({ id, summary: `Synthetic ${id}`, start: { dateTime: start }, end: { dateTime: end }, ...extra });
const agenda = items => ({ timeZone: "America/New_York", updatedAt: new Date(now).toISOString(), items });

test('calendar shows one day, preserves navigation on refresh and resets on host reopen', async () => {
  const dom = createDom('/draft/test', '<div id="host"></div>');
  const doc = dom.window.document, host = doc.getElementById('host');
  const data = normalizeAgenda(agenda([
    event('one', '2026-11-01T12:00:00-05:00', '2026-11-01T13:00:00-05:00', { backgroundColor: '#4285f4' }),
    event('two', '2026-11-01T14:00:00-05:00', '2026-11-01T15:00:00-05:00'),
    { id: 'all-day', summary: 'Planning day', start: { date: '2026-11-02' }, end: { date: '2026-11-04' } },
  ]), now);
  let clock = 0;
  const view = createCalendarCard(doc, { feed: { load: async () => data }, now: () => clock, wallNow: () => now + clock, schedule() {} });
  const context = { key: 'fixture', host, valid: () => true };
  const next = () => host.querySelector('[data-info-day="1"]');
  try {
    view.sync(context); await settle(); view.sync(context);
    assert.equal(host.querySelectorAll('.t3plus-info-event').length, 2);
    assert.equal(host.querySelector('time').dateTime, '2026-11-01');
    assert.equal(host.querySelector('h3 > a').textContent, 'Sunday, Nov 1');
    assert.equal(host.querySelector('.t3plus-info-clock').textContent, 'Now 1:30 AM');
    assert.equal(host.querySelectorAll('header [data-info-day]').length, 2);
    assert.equal(host.querySelector('details'), null);
    assert.equal(host.querySelector('.t3plus-info-event-body').style.borderLeftColor, 'rgb(66, 133, 244)');
    assert.equal(host.querySelector('[data-info-day="-1"]').disabled, true);
    next().focus(); next().click();
    assert.equal(host.querySelectorAll('.t3plus-info-event').length, 1);
    assert.match(host.querySelector('.t3plus-info-meta').textContent, /All day.*through Nov 3/);
    clock = 31000; view.sync(context);
    assert.equal(host.querySelector('time').dateTime, '2026-11-02');
    assert.equal(doc.activeElement, next());
    clock = 61000; view.sync(context);
    assert.equal(host.querySelector('.t3plus-info-clock').textContent, 'Now 1:31 AM');
    assert.equal(doc.activeElement, next());
    next().click();
    assert.equal(host.querySelector('.t3plus-info-event').textContent, 'Planning day');
    next().click();
    assert.match(host.textContent, /No upcoming events for this day/);
    for (let i = 0; i < 4; i++) next().click();
    assert.equal(next().disabled, true);
    view.reset(); view.sync(context); await settle(); view.sync(context);
    assert.equal(host.querySelector('time').dateTime, '2026-11-01');
  } finally { view.destroy(); dom.window.close(); }
});

test("agenda handles DST offsets, ongoing events, cancelled instances, exclusive all-day ends and recurring masters", () => {
  const parsed = normalizeAgenda(agenda([
    event("late", "2026-11-01T01:15:00-05:00", "2026-11-01T02:00:00-05:00"),
    event("early", "2026-11-01T01:15:00-04:00", "2026-11-01T01:45:00-04:00"),
    event("cancel", "2026-11-01T01:00:00-04:00", "2026-11-01T02:00:00-05:00", { status: "cancelled" }),
    { id: "day", summary: "All day", start: { date: "2026-11-01" }, end: { date: "2026-11-03" } },
    { id: "expired", start: { date: "2026-10-31" }, end: { date: "2026-11-01" } },
    event("master", "2026-11-01T01:00:00-04:00", "2026-11-01T02:00:00-05:00", { recurrence: ["RRULE:FREQ=DAILY"] }),
  ]), now);
  assert.deepEqual(parsed.events.map(e => e.title), ["All day", "Synthetic early", "Synthetic late"]);
  assert.match(parsed.events[0].when, /Today · All day · through Nov 2/);
  assert.match(parsed.events[1].when, /Today/);
  assert.throws(() => normalizeAgenda({ timeZone: "invalid", items: [] }), /invalid/);
});

test("agenda dates stay in source timezone and invalid/floating dates fail closed", () => {
  const raw = { timeZone: "Pacific/Honolulu", updatedAt: new Date(now).toISOString(), items: [
    { id: "day", start: { date: "2026-10-31" }, end: { date: "2026-11-01" } },
    { id: "bad", start: { date: "2026-02-30" }, end: { date: "2026-03-05" } },
    event("floating", "2026-11-01T09:00:00", "2026-11-01T10:00:00"),
  ] };
  const parsed = normalizeAgenda(raw, now);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].title, "Busy");
  assert.match(parsed.events[0].when, /Today · All day/);
});

test("agenda requires source freshness metadata and marks old snapshots stale", () => {
  assert.equal(normalizeAgenda(agenda([]), now).stale, false);
  assert.equal(normalizeAgenda({ ...agenda([]), stale: true }, now).stale, true);
  const stale = normalizeAgenda({ ...agenda([]), updatedAt: new Date(now - CALENDAR_STALE_MS).toISOString() }, now);
  assert.equal(stale.stale, true);
  assert.equal(stale.updated, now - CALENDAR_STALE_MS);
  for (const updatedAt of [undefined, 'invalid', '2026-11-01T01:30:00', new Date(now + 6 * 60000).toISOString()]) {
    assert.throws(() => normalizeAgenda({ ...agenda([]), updatedAt }, now), /freshness/);
  }
});

test("the worker reads the agenda with the task session, GET only, and never through the task write bridge", async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => "{}" }; };
  assert.equal((await fetchCalendar(fetcher)).ok, true);
  assert.deepEqual(calls.map(c => [c.url, c.init.method, c.init.credentials, c.init.redirect]), [[CALENDAR_AGENDA_ENDPOINT, "GET", "include", "error"]]);
  assert.equal((await fetchCalendar(async () => ({ ok: true, status: 200, text: async () => "x".repeat(300000) }))).ok, false);
  for (const method of ["GET", "POST"]) assert.equal(isTaskRoute(CALENDAR_AGENDA_ENDPOINT, method), false);
  assert.equal(isT3Sender({ frameId: 1, url: "https://app.t3.codes" }), false);
  assert.equal(isT3Sender({ frameId: 0, url: "https://bad.example" }), false);
  assert.equal(isT3Sender({ frameId: 0, url: "https://app.t3.codes/draft/x" }), true);
});

test("feed distinguishes sign-in, missing source, invalid JSON and empty agenda", async () => {
  let response = { ok: false, status: 401 };
  const feed = createCalendarFeed({ requestRemote: async () => response, now: () => now });
  await assert.rejects(feed.load(), e => e instanceof CalendarError && e.status === 401);
  response = { ok: false, status: 503 };
  await assert.rejects(feed.load(), /needs setup/);
  response = { ok: true, text: "<html>" };
  await assert.rejects(feed.load(), /invalid/);
  response = { ok: true, text: JSON.stringify(agenda([])) };
  assert.equal((await feed.load()).events.length, 0);
});

const GROUP = { botThreadId: "assistant", projectId: "assistant-project" };
const DRAFT_KEY = "t3code:composer-drafts:v1";
const html = `<aside data-workspace-focus-key="details:env1:draft-thread"><div data-thread-details-card><div data-slot="scroll-area-viewport"><div data-measured><section aria-label="Workspace"><button>Native control</button></section></div></div></div></aside><button data-draft-project-trigger>Project</button>`;
function setup(load) {
  const dom = createDom("/draft/test", html);
  const setDraft = (projectId = GROUP.projectId, environmentId = "env1") => dom.window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ state: { draftThreadsByThreadKey: { test: { projectId, environmentId, threadId: "draft-thread" } } } }));
  setDraft();
  const membership = { environmentId: "env1", entries: new Map([["assistant", { projectId: GROUP.projectId }]]), threads: new Map() };
  let time = 0;
  Object.defineProperty(dom.window.performance, "now", { value: () => time });
  const { app, storage } = createApp(dom, undefined, { assistantGroup: GROUP, botFeed: { readCache: async () => membership, load: async () => membership },
    calendarFeed: { load, signIn: async () => {} }, tasksFeed: { load: async () => ({ tasks: [{ id: "task", title: "Existing task", status: "open" }] }) } });
  return { dom, doc: dom.window.document, app, storage, setDraft, tick: n => { time = n; } };
}
async function ready(app) { await app.start(); await settle(); app.watcher.flush(); await settle(); app.watcher.flush(); }
const sample = () => normalizeAgenda(agenda([event("1", "2026-11-01T01:00:00-04:00", "2026-11-01T02:00:00-05:00")]), now);

test("exact draft scope renders the agenda above the untouched task region and retains native controls", async t => {
  let calls = 0;
  const { dom, doc, app, storage, setDraft } = setup(async () => { calls++; return sample(); });
  t.after(() => { app.stop(); dom.window.close(); });
  await ready(app);
  assert.ok(doc.querySelector('.t3plus-assistant-info').nextElementSibling.matches('.t3plus-tasks'));
  assert.equal(doc.querySelector('[data-measured] button').textContent, 'Native control');
  assert.match(doc.querySelector('.t3plus-tasks').textContent, /Existing task/);
  assert.equal(calls, 1);
  for (const identity of [["other-project","env1"],[GROUP.projectId,"env2"]]) {
    setDraft(...identity); app.watcher.flush();
    assert.equal(doc.querySelector('.t3plus-assistant-info'), null);
  }
  setDraft(); dom.window.history.pushState({}, "", "/env1/assistant"); app.watcher.flush();
  assert.equal(doc.querySelector('.t3plus-assistant-info'), null);
  assert.equal(calls, 1);
  assert.equal([...storage.area.data.keys()].some(k => /calendar|weather|agenda/.test(k)), false);
});

test("close/reopen same host discards late payloads, remounts and stopping removes owned UI", async () => {
  let resolve, calls = 0;
  const { dom, doc, app } = setup(() => ++calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(normalizeAgenda(agenda([]), now)));
  try {
    await ready(app);
    doc.querySelector('aside').setAttribute('data-closed', ''); app.watcher.flush();
    resolve(sample()); await settle(); app.watcher.flush();
    assert.equal(doc.querySelector('.t3plus-assistant-info'), null);
    doc.querySelector('aside').removeAttribute('data-closed'); app.watcher.flush(); await settle(); app.watcher.flush();
    assert.equal(calls, 2);
    assert.match(doc.querySelector('.t3plus-assistant-info').textContent, /No upcoming/);
    assert.doesNotMatch(doc.querySelector('.t3plus-assistant-info').textContent, /Synthetic/);
  } finally { app.stop(); assert.equal(doc.querySelector('.t3plus-assistant-info'), null); dom.window.close(); }
});

test("refresh cadence pauses hidden tabs and clears the calendar on 401", async t => {
  let calls = 0;
  const { dom, doc, app, tick } = setup(async () => {
    if (++calls > 1) throw new CalendarError("Fixture unavailable", 401);
    return sample();
  });
  t.after(() => { app.stop(); dom.window.close(); });
  await ready(app);
  tick(300001); Object.defineProperty(doc, 'visibilityState', { configurable: true, value: 'hidden' }); app.watcher.flush(); await settle();
  assert.equal(calls, 1);
  Object.defineProperty(doc, 'visibilityState', { configurable: true, value: 'visible' }); app.watcher.flush(); await settle(); app.watcher.flush();
  assert.equal(calls, 2);
  assert.doesNotMatch(doc.querySelector('.t3plus-info-calendar').textContent, /Synthetic/);
  assert.ok(doc.querySelector('[data-info-signin]'));
});

test("manual refresh becomes available after cooldown and refresh results do not replace another draft", async t => {
  let resolve, calls = 0;
  const { dom, doc, app, setDraft, tick } = setup(() => ++calls === 1 ? Promise.resolve(sample()) : new Promise(r => { resolve = r; }));
  t.after(() => { app.stop(); dom.window.close(); });
  await ready(app);
  assert.equal(doc.querySelector('[data-info-refresh]').disabled, true);
  tick(31000); app.watcher.flush();
  assert.equal(doc.querySelector('[data-info-refresh]').disabled, false);
  doc.querySelector('[data-info-refresh]').click(); app.watcher.flush(); await settle();
  assert.equal(calls, 2);
  setDraft('other');
  resolve({ timeZone: "America/New_York", events: [{ title: 'Late private fixture', when: 'Today' }] });
  await settle(); app.watcher.flush();
  assert.equal(doc.querySelector('.t3plus-assistant-info'), null);
  assert.doesNotMatch(doc.body.textContent, /Late private fixture/);
});

test("replacing the details host discards an outstanding request even for the same draft", async t => {
  let resolve, calls = 0;
  const { dom, doc, app } = setup(() => ++calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(normalizeAgenda(agenda([]), now)));
  t.after(() => { app.stop(); dom.window.close(); });
  await ready(app);
  const host = doc.querySelector('[data-measured]');
  host.replaceWith(host.cloneNode(false)); app.watcher.flush(); await settle(); app.watcher.flush();
  resolve(sample()); await settle(); app.watcher.flush();
  assert.equal(calls, 2);
  assert.match(doc.querySelector('.t3plus-info-calendar').textContent, /No upcoming/);
  assert.doesNotMatch(doc.querySelector('.t3plus-info-calendar').textContent, /Synthetic/);
});

test("returning from normal sign-in retries a 401 without changing draft or task actions", async t => {
  let calls = 0;
  const { dom, doc, app } = setup(async () => {
    if (++calls === 1) throw new CalendarError('Sign in to see your calendar.', 401);
    return sample();
  });
  t.after(() => { app.stop(); dom.window.close(); });
  await ready(app);
  assert.ok(doc.querySelector('[data-info-signin]'));
  dom.window.dispatchEvent(new dom.window.Event('focus')); app.watcher.flush(); await settle(); app.watcher.flush();
  assert.equal(calls, 2);
  assert.equal(doc.querySelector('[data-info-signin]'), null);
  assert.match(doc.querySelector('.t3plus-info-calendar').textContent, /Synthetic/);
  assert.match(doc.querySelector('.t3plus-tasks').textContent, /Existing task/);
});

test("a successful old snapshot displays Stale and never claims an empty current calendar", async t => {
  const { dom, doc, app } = setup(async () => normalizeAgenda({ ...agenda([]), updatedAt: new Date(now - 6 * 86400000).toISOString() }, now));
  t.after(() => { app.stop(); dom.window.close(); });
  await ready(app);
  const card = doc.querySelector('.t3plus-info-calendar');
  assert.match(card.querySelector('h3').textContent, /Stale/);
  assert.match(card.textContent, /No events for this day in the stale snapshot/);
  assert.match(card.querySelector('[data-info-refresh]').title, /As of/);
  assert.doesNotMatch(card.textContent, /No upcoming events in the next 7 days/);
});


test('agenda keeps the seven-day events and resolves source colors without accepting CSS', () => {
  const items = Array.from({ length: 8 }, (_, i) => event(String(i), `2026-11-0${i+1}T12:00:00-05:00`, `2026-11-0${i+1}T13:00:00-05:00`));
  items[0].backgroundColor = '#123abc';
  items[1].colorId = '9';
  items[2].calendarColor = '#abcdef';
  items[3].backgroundColor = 'red; background:url(https://example.com)';
  const data = normalizeAgenda({ ...agenda(items), colors: { event: { '9': { background: '#4285f4' } } } }, now);
  assert.equal(data.events.length, 8);
  assert.equal(data.today, '2026-11-01');
  assert.equal(data.horizon, '2026-11-08');
  assert.deepEqual(data.events.slice(0, 4).map(event => event.color), ['#123abc', '#4285f4', '#abcdef', null]);
});
