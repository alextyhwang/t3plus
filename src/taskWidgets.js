import { T3PLUS } from "./config.js";
import { CATEGORY_LABELS, TasksRequestError, VALID_CATEGORIES } from "./tasks.js";
import { createBuilder, uniqueId } from "./dom.js";

const CATEGORY_ORDER = [...VALID_CATEGORIES, null];
const taskMeta = task => [
  task.overdue && !/overdue/i.test(task.deadlineLabel) ? "Overdue" : "",
  task.status === "waiting" && !/waiting/i.test(task.deadlineLabel) ? "Waiting" : "",
  task.deadlineLabel, task.waitingReason || task.agentHint,
].filter(Boolean).join(" · ");

/** Memory-only draft view. The app checks context and revisions before writes.
 * A row control is drawn only when its callback is given. */
export function createTasksView(doc, { onRefresh = () => {}, onSignIn = null, onComplete = null, onRun = null, onCategory = null } = {}) {
  const h = createBuilder(doc);
  const element = h("section", { class: "t3plus-tasks", "aria-label": "Assistant tasks", "data-t3plus-owned": "", [T3PLUS.detailsTasksAttr]: "" });
  const busy = new Set();
  let expanded = null;
  let current = "", lastState = {}, epoch = 0, localError = "";

  function updateDisabled() {
    const unavailable = lastState.needsSignIn === true;
    for (const control of element.querySelectorAll("[data-task-id]")) {
      control.disabled = unavailable || busy.has(control.getAttribute("data-task-id")) || control.hasAttribute("data-task-unavailable");
    }
    for (const row of element.querySelectorAll("[data-task-row]")) row.setAttribute("aria-busy", String(busy.has(row.dataset.taskRow)));

  }

  async function rowAction(id, operation) {
    if (!id || busy.has(id) || lastState.needsSignIn) return;
    const started = epoch;
    const active = doc.activeElement;
    const focusAttribute = active?.dataset.taskId === id ? ["data-task-complete", "data-task-category", "data-task-run", "data-task-options"].find(attr => active.hasAttribute(attr)) : null;
    const focusValue = focusAttribute ? active.getAttribute(focusAttribute) : null;
    busy.add(id); updateDisabled();
    try { await operation(); }
    catch { if (started === epoch) { localError = "Could not save that change. Refresh before retrying."; render(lastState, true); } }
    finally { if (started === epoch) {
      busy.delete(id); updateDisabled();
      // Disabling a focused native control blurs it. Recover after acknowledgement
      // without stealing focus if the reader moved to another control meanwhile.
      if (focusAttribute && doc.activeElement === doc.body) [...element.querySelectorAll(`[${focusAttribute}]`)].find(control => control.dataset.taskId === id && control.getAttribute(focusAttribute) === focusValue)?.focus();
    } }
  }

  const onClick = event => {
    const target = event.target;
    if (target?.closest(".t3plus-tasks-refresh")) { localError = ""; render(lastState, true); onRefresh(); }
    if (onSignIn && target?.closest(".t3plus-tasks-signin")) { event.preventDefault(); onSignIn(); return; }
    const complete = target?.closest("[data-task-complete]");
    const run = target?.closest("[data-task-run]");
    const options = target?.closest("[data-task-options]");
    if (options && !options.disabled) {
      expanded = expanded === options.dataset.taskId ? null : options.dataset.taskId;
      render(lastState, true);
      if (expanded) element.querySelector("[data-task-category]")?.focus();
    }
    if (complete && !complete.disabled && onComplete) rowAction(complete.getAttribute("data-task-id"), () => onComplete(complete.getAttribute("data-task-id")));
    if (run && !run.disabled && onRun) rowAction(run.getAttribute("data-task-id"), () => onRun(run.getAttribute("data-task-id"), run.getAttribute("data-task-run")));
  };
  const onChange = event => {
    const select = event.target?.closest("[data-task-category]");
    if (!select || select.disabled || !onCategory || !VALID_CATEGORIES.includes(select.value)) return;
    const id = select.getAttribute("data-task-id");
    const category = select.value;
    rowAction(id, () => onCategory(id, category));
  };
  const onKeyDown = event => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      const id = expanded;
      expanded = null; render(lastState, true);
      [...element.querySelectorAll("[data-task-options]")].find(control => control.dataset.taskId === id)?.focus();
    }
  };
  element.addEventListener("click", onClick);
  element.addEventListener("change", onChange);
  element.addEventListener("keydown", onKeyDown);

  function render(value = {}, force = false) {
    lastState = value;
    const { state = "loading", tasks = [], error = "", page = "", needsSignIn = false } = value;
    const signature = JSON.stringify({ state, tasks, error, page, needsSignIn });
    if (!force && signature === current) return;
    current = signature;
    const scrollTop = element.querySelector(".t3plus-tasks-list")?.scrollTop ?? 0;
    const active = doc.activeElement;
    const focusStatic = [".t3plus-tasks-heading-link", ".t3plus-tasks-refresh", ".t3plus-tasks-signin", ".t3plus-tasks-list"].find(selector => active?.matches(selector));
    const focusId = element.contains(active) ? active?.getAttribute("data-task-id") : null;
    const focusAction = ["data-task-complete", "data-task-options", "data-task-category", "data-task-run"].find(attr => active?.hasAttribute(attr));
    const focusRun = active?.getAttribute("data-task-run");
    const focusIndex = [...element.querySelectorAll("[data-task-row]")].findIndex(row => row.dataset.taskRow === focusId);
    element.replaceChildren();
    element.setAttribute("aria-busy", String(state === "loading"));
    element.append(h("header", { class: "t3plus-tasks-head" }, [
      h("h3", {}, [page ? h("a", { href: page, class: "t3plus-tasks-heading-link", text: "Tasks", target: "_blank", rel: "noopener noreferrer" }) : h("span", { text: "Tasks" })]),
      h("div", { class: "t3plus-tasks-actions" }, [
        h("button", { type: "button", class: "t3plus-tasks-link t3plus-tasks-refresh", text: "↻", "aria-label": "Refresh tasks", title: "Refresh tasks", disabled: state === "loading" }),
      ]),
    ]));
    if (error || localError) element.append(h("p", { class: "t3plus-tasks-message", role: "status", text: error || localError }));
    if (needsSignIn && page) element.append(h("a", { href: page, class: "t3plus-tasks-signin", text: "Sign in with passkey", target: "_blank", rel: "noopener noreferrer" }));
    if (state === "loading" && tasks.length === 0) { element.append(h("p", { class: "t3plus-tasks-message", role: "status", text: "Loading tasks…" })); return; }
    if (tasks.length === 0 && state !== "error") element.append(h("p", { class: "t3plus-tasks-message", text: "No open tasks." }));
    if (tasks.length) {
      const list = h("ul", { class: "t3plus-tasks-list", tabindex: "0", "aria-label": "Open tasks" });
      for (const category of CATEGORY_ORDER) {
        const group = tasks.filter(task => (task.category ?? null) === category);
        for (const [index, task] of group.entries()) {
          const meta = taskMeta(task), controls = [];
          const validRevision = Number.isInteger(task.revision) && task.revision >= 0;
          const isExpanded = expanded === task.id;
          const editorId = uniqueId("task-editor");
          let editor = null;
          if (onCategory && isExpanded) {
            const select = h("select", { class: "t3plus-task-category-select", "data-task-id": task.id, "data-task-category": task.id, "data-task-unavailable": !validRevision || null, "aria-label": `Category for ${task.title}` }, [
              h("option", { value: "", text: "Needs category", disabled: true }),
              ...VALID_CATEGORIES.map(value => h("option", { value, text: CATEGORY_LABELS[value] })),
            ]);
            select.value = task.category ?? "";
            editor = h("div", { class: "t3plus-task-editor", id: editorId }, [h("span", { text: "Category" }), select]);
          }
          const complete = onComplete ? h("button", { type: "button", class: "t3plus-task-check", role: "checkbox", "aria-checked": "false", "data-task-id": task.id, "data-task-complete": task.id, "data-task-unavailable": !validRevision || null, "aria-label": `Complete ${task.title}`, title: `Complete ${task.title}` }, [h("span", { "aria-hidden": "true" })]) : null;
          if (onRun) for (const action of task.actions ?? []) controls.push(h("button", {
            type: "button", "data-task-id": task.id, "data-task-run": action.kind,
            "data-task-unavailable": !validRevision || ["queued", "running"].includes(action.state) || null,
            text: action.state === "running" ? "Running" : action.state === "queued" ? "Queued" : action.label,
          }));
          if (task.threadUrl) controls.push(h("a", { class: "t3plus-task-thread", href: task.threadUrl, text: "Open agent thread" }));
          list.append(h("li", { class: "t3plus-task", "data-task-row": task.id, "data-expanded": String(isExpanded) }, [
            index === 0 ? h("h4", { class: "t3plus-task-category", text: `${category ? CATEGORY_LABELS[category] : "Needs category"} · ${group.length}` }) : null,
            complete,
            h("div", { class: "t3plus-task-main" }, [
              h("span", { class: "t3plus-task-title", text: task.title, title: task.title }),
              meta ? h("span", { class: `t3plus-task-meta${task.overdue ? " t3plus-task-status-overdue" : ""}`, text: meta, title: meta }) : null,
              ...(task.sources ?? []).map(source => h("a", { class: "t3plus-task-source", href: source.href, text: source.label, title: source.href, "aria-label": `Source for ${task.title}: ${source.label}`, target: "_blank", rel: "noopener noreferrer" })),
            ]),
            h("button", { type: "button", class: "t3plus-task-options", "data-task-id": task.id, "data-task-options": "", "aria-label": `Options for ${task.title}`, title: "Task options", "aria-expanded": String(isExpanded), "aria-controls": editor ? editorId : null, text: "…" }),
            editor,
            controls.length ? h("div", { class: "t3plus-task-controls" }, controls) : null,
          ]));
        }
      }
      element.append(list); list.scrollTop = scrollTop;
    }
    updateDisabled();
    if (focusStatic) element.querySelector(focusStatic)?.focus();
    else if (focusId && focusAction) {
      const control = [...element.querySelectorAll(`[${focusAction}]`)].find(node => node.dataset.taskId === focusId && (focusAction !== "data-task-run" || node.getAttribute(focusAction) === focusRun));
      const rows = [...element.querySelectorAll("[data-task-row]")];
      (control ?? rows.find(row => row.dataset.taskRow === focusId)?.querySelector("[data-task-options]") ?? rows[Math.min(focusIndex, rows.length - 1)]?.querySelector("[data-task-complete], [data-task-options]") ?? element.querySelector(".t3plus-tasks-refresh"))?.focus();
    }
    const list = element.querySelector(".t3plus-tasks-list");
    if (list) list.scrollTop = scrollTop;
  }
  function reset() {
    epoch++; current = ""; lastState = {}; busy.clear(); localError = "";
    expanded = null; element.replaceChildren();
  }
  return { element, update: render, reset, destroy() {
    reset();
    element.removeEventListener("click", onClick);
    element.removeEventListener("change", onChange);
    element.removeEventListener("keydown", onKeyDown);
  } };
}

export const TASKS_REFRESH_MS = 60 * 1000;
const idleTasks = () => ({ state: "loading", tasks: [], error: "" });

/**
 * The Assistant draft's task list. `sync({ key, host, valid })` shows it for
 * one draft (null hides it); the board reloads on a new draft and every
 * TASKS_REFRESH_MS. Writes are dropped when the draft changed meanwhile.
 */
export function createTasksPanel(doc, { feed, schedule, now }) {
  let contextKey = null, valid = () => false;
  let request = 0, loading = false, epoch = 0, mutating = 0, notice = "", lastFetch = -Infinity;
  let state = idleTasks();

  async function mutate(operation, fallback) {
    const key = contextKey, started = epoch;
    const current = () => key && started === epoch && contextKey === key && view.element.isConnected && valid();
    if (!current()) return false;
    // An older board response must not overwrite the result of this write.
    request++; loading = false; mutating++; notice = "";
    try {
      await operation();
      if (!current()) return false;
      lastFetch = -Infinity;
      return true;
    } catch (error) {
      if (!current()) return false;
      const status = error instanceof TasksRequestError ? error.status : 0;
      const message = error instanceof TasksRequestError ? error.message : fallback;
      if (status === 409) {
        notice = `${message} The list has been refreshed; review it before retrying.`;
        lastFetch = -Infinity;
      }
      state = { ...state, state: "error", error: notice || message, needsSignIn: status === 401 };
      return false;
    } finally {
      if (current()) { mutating--; schedule(); }
    }
  }

  function mutateTask(id, operation, fallback) {
    const task = state.tasks.find(entry => entry.id === id);
    if (!task || !Number.isInteger(task.revision) || task.revision < 0) return Promise.resolve(false);
    return mutate(() => operation(task), fallback);
  }

  const view = createTasksView(doc, {
    onRefresh() { notice = ""; lastFetch = -Infinity; schedule(); },
    onComplete: id => mutateTask(id, task => feed.completeTask(task), "Could not complete that task."),
    onRun: (id, kind) => mutateTask(id, task => feed.runTask(task, kind), "Could not launch that agent."),
    onCategory: (id, category) => mutateTask(id, task => feed.updateCategory(task, category), "Could not update that category."),
    onSignIn: feed?.signIn ? async () => {
      const key = contextKey;
      try {
        await feed.signIn();
      } catch {
        if (contextKey !== key) return;
        state = { ...state, error: "Could not open sign-in. Use the Tasks link to sign in, then return here." };
        schedule();
      }
    } : null,
  });

  function hide() {
    if (contextKey !== null) { epoch++; view.reset(); }
    request++;
    contextKey = null;
    loading = false;
    mutating = 0;
    notice = "";
    state = idleTasks();
    view.element.remove();
  }

  function sync(context) {
    if (!context) { hide(); return; }
    const { key, host } = context;
    valid = context.valid;
    const changedContext = contextKey !== key;
    if (changedContext) { epoch++; mutating = 0; notice = ""; view.reset(); }
    if (changedContext || (!loading && !mutating && now() - lastFetch >= TASKS_REFRESH_MS)) {
      contextKey = key;
      loading = true;
      state = { state: "loading", tasks: changedContext ? [] : state.tasks, error: "" };
      const started = ++request;
      Promise.resolve().then(() => feed.load()).then((board) => {
        if (started !== request || contextKey !== key) return;
        loading = false;
        lastFetch = now();
        state = { state: "ready", tasks: board.tasks, error: notice };
        schedule();
      }).catch((error) => {
        if (started !== request || contextKey !== key) return;
        loading = false;
        lastFetch = now();
        state = { state: "error", tasks: [], error: error instanceof TasksRequestError ? error.message : "Could not load your tasks.", needsSignIn: error instanceof TasksRequestError && error.status === 401 };
        schedule();
      });
    }
    if (view.element.parentElement !== host) host.append(view.element);
    view.update({ ...state, page: feed.page });
  }

  return {
    element: view.element,
    sync,
    /** Back from the passkey window: retry a 401 at once. */
    focus() {
      if (state.needsSignIn && view.element.isConnected) { lastFetch = -Infinity; schedule(); }
    },
    destroy() { hide(); view.destroy(); },
  };
}
