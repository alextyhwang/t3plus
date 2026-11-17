import assert from "node:assert/strict";
import { test } from "node:test";
import { createTasksView } from "../src/taskWidgets.js";
import { createTasksFeed, parseTasksBoardText, TasksRequestError } from "../src/tasks.js";
import { openTasksSignIn } from "../src/background.js";
import { createApp, createDom, settle } from "./helpers.js";

const GROUP = { botThreadId: "assistant", projectId: "assistant-project" };
const details = `
  <aside data-workspace-area="details" data-workspace-focus-key="details:env1:assistant">
    <div data-thread-details-card="true">
      <div data-slot="scroll-area-viewport"><div data-measured="true">
        <section aria-label="Workspace"></section>
      </div></div>
    </div>
  </aside>`;
const DRAFT_KEY = "t3code:composer-drafts:v1";
const draftRecord = (projectId = GROUP.projectId, environmentId = "env1") => ({ projectId, environmentId, threadId: "draft-thread" });
const draftDetails = details.replace("details:env1:assistant", "details:env1:draft-thread") + '<button data-draft-project-trigger>Project</button>';
function setDraft(win, record) {
  win.localStorage.setItem(DRAFT_KEY, JSON.stringify({ state: { draftThreadsByThreadKey: { draft1: record } }, version: 1 }));
}

const task = (id, title = "Review the compact card") => ({ id, title, status: "open", deadline_label: "Today" });
const boardText = (tasks = [task("t1")]) => JSON.stringify({ today: tasks, upcoming: [], waiting: [] });
const normalized = (tasks) => parseTasksBoardText(boardText(tasks));
const scope = () => ({
  environmentId: "env1",
  entries: new Map([["assistant", { projectId: GROUP.projectId }]]),
  threads: new Map([["child", { projectId: GROUP.projectId }], ["other", { projectId: "other-project" }]]),
});
const selector = "[data-t3plus-details-tasks]";
function setup({ path = "/draft/draft1", html = draftDetails, membership = scope(), load = async () => normalized(), signIn, beforeStart } = {}) {
  const dom = createDom(path, html);
  setDraft(dom.window, draftRecord());
  beforeStart?.(dom.window);
  const botFeed = { readCache: async () => membership, load: async () => membership };
  const tasksFeed = { page: "https://tasks.example/tasks", load, signIn };
  const { app, storage } = createApp(dom, undefined, { assistantGroup: GROUP, tasksFeed, botFeed });
  return { dom, doc: dom.window.document, app, storage };
}
async function ready(app) { await app.start(); await settle(); app.watcher.flush(); }
const titles = (doc) => [...doc.querySelectorAll(".t3plus-task-title")].map((el) => el.textContent);

test("task parser validates the board and removes terminal rows and duplicate ids", () => {
  const parsed = parseTasksBoardText(JSON.stringify({
    today: [{ ...task("a", "Keep"), overdue: true }, task("a", "Duplicate")],
    upcoming: [{ ...task("b", "Done"), status: "completed" }, { ...task("c"), status: "dismissed" }],
    waiting: [{ ...task("d", "Waiting"), status: "waiting", waiting_reason: "Review" }],
  }));
  assert.deepEqual(parsed.tasks.map((t) => [t.id, t.title]), [["a", "Keep"], ["d", "Waiting"]]);
  assert.equal(parsed.tasks[0].overdue, true);
  for (const value of ["not json", "[]", "{}", '{"today":{}}', '{"today":[],"upcoming":[],"waiting":false}']) {
    assert.equal(parseTasksBoardText(value), null, value);
  }
  assert.deepEqual(normalized([]).tasks, []);
  assert.equal(normalized(Array.from({ length: 100 }, (_, i) => task(String(i)))).tasks.length, 100);
});

test("task client reports authentication, bad schema and network errors", async () => {
  const client = (response) => createTasksFeed({ requestRemote: async () => response });
  await assert.rejects(client({ ok: false, status: 401 }).load(), (e) => e instanceof TasksRequestError && e.status === 401);
  await assert.rejects(client({ ok: true, text: "{}" }).load(), /invalid response/);
  await assert.rejects(createTasksFeed({ requestRemote: async () => { throw new Error("offline"); } }).load(), /offline/);
  assert.equal((await client({ ok: true, text: boardText() }).load()).tasks[0].title, "Review the compact card");
});

test("task view renders every row safely and opens tasks in another tab", () => {
  const dom = createDom("/env1/assistant", "");
  const view = createTasksView(dom.window.document);
  const tasks = normalized(Array.from({ length: 5 }, (_, i) => task(String(i), i ? "Task" : "<img src=x>"))).tasks;
  view.update({ state: "loading" });
  assert.equal(view.element.getAttribute("aria-busy"), "true");
  view.update({ state: "ready", tasks, page: "https://tasks.example/tasks" });
  assert.equal(view.element.getAttribute("aria-busy"), "false");
  assert.equal(view.element.querySelectorAll(".t3plus-task").length, 5);
  assert.equal(view.element.querySelector("img"), null);
  assert.equal(view.element.querySelector(".t3plus-tasks-more"), null);
  view.update({ state: "ready", tasks: [...tasks, tasks[4]], page: "https://tasks.example/tasks" });
  assert.equal(view.element.querySelectorAll(".t3plus-task").length, 6);
  assert.equal(view.element.querySelector("a").target, "_blank");
  view.update({ state: "error", error: "Sign in to see your tasks." });
  assert.match(view.element.textContent, /Sign in/);
  assert.equal(view.element.querySelector(".t3plus-task"), null);
  view.update({ state: "ready", tasks: [] });
  assert.match(view.element.textContent, /No open tasks/);
  view.destroy();
});

test("tasks display in the measured host without Usage limits and independently of its setting", async (t) => {
  const { doc, app, storage } = setup();
  t.after(() => app.stop());
  await ready(app);
  assert.equal(doc.querySelector(selector).parentElement.getAttribute("data-measured"), "true");
  assert.deepEqual(titles(doc), ["Review the compact card"]);
  await app.actions.setHomeWidgets(false);
  app.watcher.flush();
  assert.deepEqual(titles(doc), ["Review the compact card"]);
  assert.equal([...storage.area.data.keys()].some((key) => /tasks/i.test(key)), false);
});

test("tasks are hidden without a confirmed environment or for the same bot id in a different environment", async (t) => {
  for (const membership of [null, { ...scope(), environmentId: null }, { ...scope(), environmentId: "env2" }]) {
    let calls = 0;
    const { doc, app } = setup({ membership, load: async () => { calls++; return normalized(); } });
    await ready(app);
    assert.equal(doc.querySelector(selector), null);
    assert.equal(calls, 0);
    app.stop();
  }
});

test("saved conversations never show or fetch tasks, including Assistant and its project threads", async () => {
  for (const thread of ["assistant", "child", "other"]) {
    let calls = 0;
    const { doc, app } = setup({path: `/env1/${thread}`, html: details.replace("details:env1:assistant", `details:env1:${thread}`), load: async () => {calls++; return normalized();}});
    try {
      await ready(app);
      assert.equal(doc.querySelector(selector), null);
      assert.equal(doc.querySelector('[data-t3plus-tasks-layout]'), null);
      assert.equal(calls, 0);
    } finally { app.stop(); }
  }
});

test("late task responses cannot leak into another project", async (t) => {
  let resolve;
  const { dom, doc, app } = setup({ load: () => new Promise((r) => { resolve = r; }) });
  t.after(() => app.stop());
  await ready(app);
  dom.window.history.pushState({}, "", "/env1/other");
  app.watcher.flush();
  resolve(normalized());
  await settle();
  app.watcher.flush();
  assert.equal(doc.querySelector(selector), null);
});

test("closed details discard pending data and remount cleanly when reopened", async (t) => {
  let resolve;
  let calls = 0;
  const { doc, app } = setup({ load: () => { calls++; return calls === 1 ? new Promise((r) => { resolve = r; }) : Promise.resolve(normalized()); } });
  t.after(() => app.stop());
  await ready(app);
  doc.querySelector("aside").setAttribute("data-closed", "");
  await settle();
  app.watcher.flush();
  assert.equal(doc.querySelector(selector), null);
  resolve(normalized([task("private", "Old response")]));
  await settle();
  app.watcher.flush();
  assert.equal(doc.querySelector(selector), null);
  doc.querySelector("aside").removeAttribute("data-closed");
  app.watcher.flush();
  await settle();
  app.watcher.flush();
  assert.equal(calls, 2);
  assert.deepEqual(titles(doc), ["Review the compact card"]);
});

test("Refresh recovers an authentication failure without closing details", async (t) => {
  let calls = 0;
  const { doc, app } = setup({ load: async () => {
    if (++calls === 1) throw new TasksRequestError("Sign in to see your tasks.", 401);
    return normalized();
  } });
  t.after(() => app.stop());
  await ready(app);
  assert.match(doc.querySelector(selector).textContent, /Sign in/);
  doc.querySelector(".t3plus-tasks-refresh").click();
  app.watcher.flush();
  await settle();
  app.watcher.flush();
  assert.equal(calls, 2);
  assert.deepEqual(titles(doc), ["Review the compact card"]);
});

test("tasks refresh while visible, pause for hidden tabs and stop on cleanup", async () => {
  let time = 0;
  let calls = 0;
  const intervals = [];
  const { dom, doc, app } = setup({
    load: async () => normalized([task("t1", "Revision " + ++calls)]),
    beforeStart(win) {
      Object.defineProperty(win.performance, "now", { value: () => time });
      const original = win.setInterval.bind(win);
      win.setInterval = (fn, delay) => { intervals.push({ fn, delay }); return original(fn, delay); };
    },
  });
  await ready(app);
  const timer = intervals.filter((i) => i.delay === 60000).at(-1);
  time = 61000;
  timer.fn();
  app.watcher.flush();
  await settle();
  app.watcher.flush();
  assert.deepEqual(titles(doc), ["Revision 2"]);
  Object.defineProperty(doc, "visibilityState", { configurable: true, value: "hidden" });
  time = 122000;
  timer.fn();
  await settle();
  assert.equal(calls, 2);
  app.stop();
  assert.equal(doc.querySelector(selector), null);
});

test("draft details use the selected draft's exact project and environment, never the last-used project", async (t) => {
  let calls = 0;
  const { dom, doc, app } = setup({ path: "/draft/draft1", html: draftDetails,
    beforeStart(win) { setDraft(win, draftRecord()); },
    load: async () => { calls++; return normalized(); },
  });
  t.after(() => app.stop());
  await ready(app);
  assert.deepEqual(titles(doc), ["Review the compact card"]);
  assert.ok(doc.querySelector('[data-thread-details-card][data-t3plus-tasks-layout]'));
  for (const record of [draftRecord("other-project"), draftRecord(GROUP.projectId, "env2"), null]) {
    setDraft(dom.window, record);
    dom.window.localStorage.setItem("t3code:last-used-project:v1", '"env1:assistant-project"');
    app.watcher.flush();
    assert.equal(doc.querySelector(selector), null);
    assert.equal(doc.querySelector('[data-t3plus-tasks-layout]'), null);
  }
  assert.equal(calls, 1);
  setDraft(dom.window, draftRecord());
  app.watcher.flush(); await settle(); app.watcher.flush();
  assert.deepEqual(titles(doc), ["Review the compact card"]);
  doc.querySelector("aside").setAttribute("data-workspace-focus-key", "details:env1:stale-draft");
  app.watcher.flush();
  assert.equal(doc.querySelector(selector), null);
});

test("drafts fail closed on unavailable storage and project changes discard late responses", async (t) => {
  let resolve;
  const { dom, doc, app } = setup({ path: "/draft/draft1", html: draftDetails,
    beforeStart(win) { setDraft(win, draftRecord()); },
    load: () => new Promise(r => { resolve = r; }),
  });
  t.after(() => app.stop());
  await ready(app);
  setDraft(dom.window, draftRecord("other-project"));
  app.watcher.flush();
  resolve(normalized()); await settle(); app.watcher.flush();
  assert.equal(doc.querySelector(selector), null);
  dom.window.localStorage.setItem(DRAFT_KEY, "broken json"); app.watcher.flush();
  assert.equal(doc.querySelector(selector), null);
  Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("blocked"); } });
  app.watcher.flush();
  assert.equal(doc.querySelector(selector), null);
});

test("401 offers sign-in and returning to T3 reloads the authenticated board", async (t) => {
  let calls = 0, popups = 0;
  const { dom, doc, app } = setup({ signIn: async () => { popups++; }, load: async () => {
    if (++calls === 1) throw new TasksRequestError("Sign in to see your tasks.", 401);
    return normalized(Array.from({length: 18}, (_, i) => task(String(i))));
  } });
  t.after(() => app.stop());
  await ready(app);
  doc.querySelector(".t3plus-tasks-signin").click(); await settle();
  assert.equal(popups, 1);
  dom.window.dispatchEvent(new dom.window.Event("focus"));
  app.watcher.flush(); await settle(); app.watcher.flush();
  assert.equal(calls, 2);
  assert.equal(titles(doc).length, 18);
  assert.equal(doc.querySelector(".t3plus-tasks-signin"), null);
});

test("sign-in window only opens the configured site from a T3 top frame", async () => {
  const created = [];
  const options = { page: "https://tasks.example/tasks", windows: { create: async data => { created.push(data); } } };
  for (const sender of [{ url: "https://evil.example/", frameId: 0 }, { url: "https://app.t3.codes/", frameId: 1 }, { url: "invalid", frameId: 0 }]) {
    assert.equal((await openTasksSignIn(sender, options)).ok, false);
  }
  const sender = { url: "https://app.t3.codes/draft/example", frameId: 0 };
  assert.equal(created.length, 0);
  assert.equal((await openTasksSignIn(sender, options)).ok, true);
  assert.deepEqual(created, [{ url: "https://tasks.example/tasks", type: "popup", width: 480, height: 640, focused: true }]);
  assert.equal((await openTasksSignIn(sender, { ...options, windows: { create: async () => { throw new Error("unavailable"); } } })).ok, false);
});


test("refresh keeps every existing row and the reader's scroll position until new data arrives", () => {
  const dom = createDom("/draft/draft1", "");
  const view = createTasksView(dom.window.document);
  const tasks = normalized(Array.from({length: 100}, (_, i) => task(String(i)))).tasks;
  view.update({state: "ready", tasks});
  view.element.querySelector("ul").scrollTop = 320;
  view.update({state: "loading", tasks});
  assert.equal(view.element.querySelectorAll("li").length, 100);
  assert.equal(view.element.querySelector("ul").scrollTop, 320);
  view.update({state: "ready", tasks: [...tasks.slice(0,99), {...tasks[99], title: "Updated"}]});
  assert.equal(view.element.querySelector("ul").scrollTop, 320);
  assert.match(view.element.textContent, /Updated/);
  view.destroy();
});
