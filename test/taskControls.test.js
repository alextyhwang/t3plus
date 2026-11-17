import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTasksFeed, parseTasksBoardText, TasksRequestError } from '../src/tasks.js';
import { createTasksView } from '../src/taskWidgets.js';
import { fetchTaskRequest } from '../src/background.js';
import { TASKS_API_ENDPOINT } from '../src/hosts.js';
import { createApp, createDom, settle } from './helpers.js';

const wireTask = (i, extra = {}) => ({ id: `fixture-${i}`, title: `Synthetic task ${i}`, status: 'open', category: i < 21 ? 'schoolwork' : null, revision: 1, actions: [], activity: [], ...extra });
const wireBoard = (rows) => ({ today: rows.slice(0, 10), upcoming: rows.slice(10), waiting: [], open: rows, categories: [{ id: 'schoolwork', label: 'Schoolwork', count: 21 }, { id: null, label: 'Needs category', count: 41 }] });
const rows = (tasks) => parseTasksBoardText(JSON.stringify(wireBoard(tasks))).tasks;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

test('metadata preserves complete source destinations before truncation and rejects credentialed URLs', () => {
  const url = `https://courses.example/content/${'reference/'.repeat(30)}?view=full`;
  const [task] = rows([wireTask(0, { agent_hint: `Course portal: ${url}`, deadline_label: 'Overdue · Yesterday' })]);
  assert.deepEqual(task.sources, [{ href: url, label: 'Course portal' }]);
  assert.equal(task.agentHint, '');
  assert.equal(task.deadlineLabel, 'Overdue · Yesterday');
  for (const candidate of ['https://user:password@example.com/private', `https://example.com/${'x'.repeat(2100)}`, 'javascript:alert(1)']) {
    assert.deepEqual(rows([wireTask(0, { agent_hint: candidate })])[0].sources, []);
  }
});

test('row options reveal category only on request, preserve focus across refresh and close with Escape', () => {
  const dom = createDom('/draft/test', '');
  const doc = dom.window.document;
  const view = createTasksView(doc, { onCategory() {}, onComplete() {} });
  doc.body.append(view.element);
  const state = { state: 'ready', canWrite: true, tasks: rows([wireTask(0), wireTask(1)]) };
  try {
    view.update(state);
    assert.equal(view.element.querySelector('[data-task-category]'), null);
    const options = view.element.querySelector('[data-task-options]');
    options.focus(); options.click();
    assert.equal(doc.activeElement, view.element.querySelector('[data-task-category]'));
    view.update({ ...state, error: 'Retained rows during refresh' });
    assert.equal(doc.activeElement, view.element.querySelector('[data-task-category]'));
    doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(view.element.querySelector('[data-task-category]'), null);
    assert.equal(doc.activeElement, view.element.querySelector('[data-task-options]'));
    const check = view.element.querySelector('[data-task-complete]');
    assert.equal(check.getAttribute('role'), 'checkbox');
    assert.equal(check.getAttribute('aria-checked'), 'false');
    check.focus();
    view.update({ ...state, tasks: state.tasks.slice(1) });
    assert.equal(doc.activeElement, view.element.querySelector('[data-task-complete]'));
    assert.equal(doc.activeElement.dataset.taskId, 'fixture-1');
  } finally { view.destroy(); dom.window.close(); }
});

test('source links have short text, full destination and no duplicated overdue label', () => {
  const dom = createDom('/draft/test', '');
  const view = createTasksView(dom.window.document);
  try {
    const url = 'https://courses.example/a/long/source?section=notes';
    view.update({ state: 'ready', tasks: rows([wireTask(0, { overdue: true, deadline_label: 'Overdue · Yesterday', agent_hint: `Portal: ${url}` })]) });
    const source = view.element.querySelector('.t3plus-task-source');
    assert.equal(source.href, url); assert.equal(source.title, url); assert.equal(source.textContent, 'Portal');
    assert.equal(view.element.querySelector('.t3plus-task-meta').textContent, 'Overdue · Yesterday');
    assert.equal(view.element.querySelector('.t3plus-task-status'), null);
  } finally { view.destroy(); dom.window.close(); }
});

test('new board contract renders all 62 synthetic open rows in their categories without duplicating open', () => {
  const tasks = rows(Array.from({ length: 62 }, (_, i) => wireTask(i)));
  const dom = createDom('/draft/test', '');
  const view = createTasksView(dom.window.document);
  try {
    view.update({ state: 'ready', tasks });
    assert.equal(view.element.querySelectorAll('.t3plus-task').length, 62);
    assert.equal(tasks.filter(t => t.category === 'schoolwork').length, 21);
    assert.equal(tasks.filter(t => t.category === null).length, 41);
    assert.deepEqual([...view.element.querySelectorAll('.t3plus-task-category')].map(e => e.textContent), ['Schoolwork · 21', 'Needs category · 41']);
  } finally { view.destroy(); dom.window.close(); }
});

test('worker sends credentials, JSON and CSRF only to allowlisted task routes', async () => {
  const api = TASKS_API_ENDPOINT;
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    assert.equal(url, `${api}/fixture/edit`);
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['X-CSRF-Token'], 'synthetic-csrf');
    assert.deepEqual(JSON.parse(init.body), { revision: 1, action: 'complete', csrf: 'synthetic-csrf' });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  assert.equal((await fetchTaskRequest({ url: `${api}/fixture/edit`, method: 'POST', body: { revision: 1, action: 'complete' }, csrf: 'synthetic-csrf' }, fetchImpl)).ok, true);
  for (const url of ['https://elsewhere.example/api/tasks/fixture/edit', `${api}/login/finish`, `${api}/fixture/edit?x=1`, `${api}/../settings`]) {
    assert.equal((await fetchTaskRequest({ url, method: 'POST', body: {}, csrf: 'synthetic-csrf' }, fetchImpl)).ok, false);
  }
  assert.equal(calls, 1);
});

test('board failures explain portal outages and preserve the HTTP status', async () => {
  for (const [status, error, expected] of [
    [404, "Not Found", /HTTP 404.*portal.*board API route/i],
    [503, "Gateway unavailable", /HTTP 503.*Try again later.*Gateway unavailable/i],
    [0, "Failed to fetch", /Could not reach the task service.*Failed to fetch/i],
  ]) {
    const feed = createTasksFeed({ requestRemote: async () => ({ ok: false, status, error }) });
    await assert.rejects(feed.load(), thrown => thrown instanceof TasksRequestError && thrown.status === status && expected.test(thrown.message));
  }
});

test('running actions show Running rather than Queued', () => {
  const dom = createDom('/draft/test', '');
  const view = createTasksView(dom.window.document, { onRun() {} });
  try {
    view.update({ state: 'ready', canWrite: true, tasks: rows([wireTask(0, { actions: [{ kind: 'smoke_test', label: 'Run test', state: 'running' }] })]) });
    assert.equal(view.element.querySelector('[data-task-run]').textContent, 'Running');
  } finally { view.destroy(); dom.window.close(); }
});



test('category headers preserve valid list semantics', () => {
  const dom = createDom('/draft/test', '');
  const view = createTasksView(dom.window.document);
  try {
    view.update({ state: 'ready', tasks: rows([wireTask(0), wireTask(25)]) });
    assert.ok([...view.element.querySelector('.t3plus-tasks-list').children].every(e => e.tagName === 'LI'));
  } finally { view.destroy(); dom.window.close(); }
});

test('session expiry during a write offers passkey sign-in inside the widget', async () => {
  const dom = createDom('/draft/draft1', '<aside data-workspace-area="details" data-workspace-focus-key="details:env1:draft-thread"><div data-thread-details-card="true"><div data-slot="scroll-area-viewport"><div data-measured="true"><section aria-label="Workspace"></section></div></div></div></aside><button data-draft-project-trigger>Project</button>');
  dom.window.localStorage.setItem('t3code:composer-drafts:v1', JSON.stringify({ state: { draftThreadsByThreadKey: { draft1: { projectId: 'assistant-project', environmentId: 'env1', threadId: 'draft-thread' } } }, version: 1 }));
  const membership = { environmentId: 'env1', entries: new Map([['assistant', { projectId: 'assistant-project' }]]), threads: new Map() };
  const feed = { page: 'https://tasks.example/tasks', load: async () => ({ tasks: rows([wireTask(0)]) }), updateCategory() {}, completeTask: async () => { throw new TasksRequestError('Sign in to see your tasks.', 401); }, signIn() {} };
  const { app } = createApp(dom, undefined, { assistantGroup: { botThreadId: 'assistant', projectId: 'assistant-project' }, tasksFeed: feed, botFeed: { readCache: async () => membership, load: async () => membership } });
  try {
    await app.start(); await settle(); app.watcher.flush();
    dom.window.document.querySelector('[data-task-complete]').click();
    await settle(); app.watcher.flush();
    assert.ok(dom.window.document.querySelector('.t3plus-tasks-signin'), '401 from completeTask should expose the passkey action');
  } finally { app.stop(); dom.window.close(); }
});


test('a task row prevents overlapping edits while a different row stays usable', async () => {
  const dom = createDom('/draft/test', '');
  const pending = deferred();
  let calls = 0;
  const view = createTasksView(dom.window.document, { onComplete: () => { calls++; return pending.promise; }, onRun: () => { calls++; } });
  try {
    view.update({ state: 'ready', canWrite: true, tasks: rows([wireTask(0, { actions: [{ kind: 'smoke_test', label: 'Run', state: 'idle' }] }), wireTask(1)]) });
    view.element.querySelector('[data-task-complete]').click();
    assert.equal(view.element.querySelector('[data-task-run]').disabled, true);
    assert.equal(view.element.querySelectorAll('[data-task-complete]')[1].disabled, false);
    view.element.querySelector('[data-task-run]').click();
    assert.equal(calls, 1);
    pending.resolve(); await settle();
    assert.equal(view.element.querySelector('[data-task-run]').disabled, false);
  } finally { pending.resolve(); view.destroy(); dom.window.close(); }
});

test('CSRF rejection refreshes the session on the next explicit write without replaying the failed write', async () => {
  let sessions = 0, writes = 0;
  const feed = createTasksFeed({ requestRemote: async request => {
    if (request.method === 'GET') return { ok: true, status: 200, text: JSON.stringify({ authenticated: true, csrf: `synthetic-${++sessions}` }) };
    writes++;
    if (writes === 1) return { ok: false, status: 403, text: JSON.stringify({ error: 'CSRF rejected' }) };
    assert.equal(request.csrf, 'synthetic-2');
    return { ok: true, status: 200, text: JSON.stringify({ task: wireTask(0) }) };
  } });
  await assert.rejects(feed.completeTask({ id: 'fixture-0', revision: 1 }), error => error.status === 403);
  assert.equal(writes, 1);
  await feed.completeTask({ id: 'fixture-0', revision: 1 });
  assert.equal(sessions, 2); assert.equal(writes, 2);
});

async function appFixture(overrides = {}) {
  const dom = createDom('/draft/draft1', '<aside data-workspace-area="details" data-workspace-focus-key="details:env1:draft-thread"><div data-thread-details-card="true"><div data-slot="scroll-area-viewport"><div data-measured="true"><section aria-label="Workspace"></section></div></div></div></aside><button data-draft-project-trigger>Project</button>');
  const setDraft = (projectId = 'assistant-project') => dom.window.localStorage.setItem('t3code:composer-drafts:v1', JSON.stringify({ state: { draftThreadsByThreadKey: { draft1: { projectId, environmentId: 'env1', threadId: 'draft-thread' } } }, version: 1 }));
  setDraft();
  const membership = { environmentId: 'env1', entries: new Map([['assistant', { projectId: 'assistant-project' }]]), threads: new Map() };
  const feed = { page: 'https://tasks.example/tasks', load: async () => ({ tasks: rows([wireTask(0)]) }), updateCategory() {}, completeTask() {}, ...overrides };
  const { app } = createApp(dom, undefined, { assistantGroup: { botThreadId: 'assistant', projectId: 'assistant-project' }, tasksFeed: feed, botFeed: { readCache: async () => membership, load: async () => membership } });
  await app.start(); await settle(); app.watcher.flush();
  return { dom, app, doc: dom.window.document, setDraft };
}

test('409 reloads the canonical board and never repeats the stale mutation', async () => {
  let loads = 0, writes = 0;
  const fixture = await appFixture({
    load: async () => ({ tasks: rows([wireTask(0, { revision: ++loads })]) }),
    completeTask: async task => { writes++; assert.equal(task.revision, 1); throw new TasksRequestError('Task changed; reload it', 409); },
  });
  try {
    fixture.doc.querySelector('[data-task-complete]').click(); await settle();
    fixture.app.watcher.flush(); await settle(); fixture.app.watcher.flush();
    assert.equal(loads, 2); assert.equal(writes, 1);
    assert.match(fixture.doc.querySelector('.t3plus-tasks').textContent, /review it before retrying/);
    assert.ok(fixture.doc.querySelector('[data-task-complete]'));
  } finally { fixture.app.stop(); fixture.dom.window.close(); }
});

test('late write failure cannot leak into a reopened draft', async () => {
  const pending = deferred();
  const fixture = await appFixture({ completeTask: () => pending.promise });
  try {
    fixture.doc.querySelector('[data-task-complete]').click();
    fixture.doc.querySelector('[data-thread-details-card]').hidden = true;
    fixture.app.watcher.flush();
    fixture.doc.querySelector('[data-thread-details-card]').hidden = false;
    fixture.app.watcher.flush(); await settle(); fixture.app.watcher.flush();
    pending.reject(new TasksRequestError('Old session expired', 401));
    await settle(); fixture.app.watcher.flush();
    assert.doesNotMatch(fixture.doc.querySelector('.t3plus-tasks').textContent, /Old session expired/);
    assert.equal(fixture.doc.querySelector('form'), null);
    assert.equal(fixture.doc.querySelector('.t3plus-tasks-signin'), null);
  } finally { fixture.app.stop(); fixture.dom.window.close(); }
});


test('task widget only displays existing tasks, with no creation controls in any state', () => {
  const dom = createDom('/draft/test', '');
  const view = createTasksView(dom.window.document);
  try {
    for (const state of ['ready', 'loading', 'error']) {
      view.update({ state, canWrite: true, tasks: rows([wireTask(0)]), error: state === 'error' ? 'Unavailable' : '' });
      assert.equal(view.element.querySelector('form, input, [type=submit]'), null);
      assert.equal(view.element.querySelectorAll('.t3plus-task').length, 1);
    }
  } finally { view.destroy(); dom.window.close(); }
});
