// Synthetic widget fixture, not a real T3 capture or authenticated service test.
// node harness/assistantWidgets.mjs; python harness/assistantWidgets.py
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("harness/out/assistant-widgets", { recursive: true });
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
import { createTasksView } from './src/taskWidgets.js';
import { createCalendarCard } from './src/calendarWidgets.js';
import { normalizeAgenda } from './src/calendar.js';
import { parseTasksBoardText } from './src/tasks.js';
const host = document.querySelector('[data-t3plus-tasks-host]');
let state, pending, calendarState = 'ready', generation = 0;
window.calls = [];
const rows = Array.from({ length: 18 }, (_, i) => ({ id: 'task-' + i, revision: 1, status: i === 4 ? 'waiting' : 'open',
  title: ['Prepare the workshop notes and share the reference material with the group', 'Review the draft proposal', 'Plan next week', 'Follow up on the application'][i % 4],
  category: i < 8 ? 'schoolwork' : i < 12 ? 'job' : i < 16 ? 'personal' : null,
  overdue: i < 2, deadline_label: i < 2 ? 'Overdue · Nov 3, 2026 at 5:00 PM' : 'Tomorrow',
  agent_hint: i % 3 === 0 ? 'Course portal: https://courses.example/lessons/' + 'reference-material/'.repeat(12) + '?view=full' : '',
  waiting_reason: i === 4 ? 'Waiting for feedback from the project team before proceeding with the next revision' : '',
  actions: i === 2 ? [{kind:'review',label:'Run review',state:'idle'}] : [], activity: [] }));
const tasks = parseTasksBoardText(JSON.stringify({ today: rows, upcoming: [], waiting: [] })).tasks;
function action(kind, id, value) { window.calls.push({kind, id, value}); return new Promise((resolve, reject) => { pending = { resolve, reject }; }); }
const view = createTasksView(document, { onComplete: id => action('complete', id), onCategory: (id, value) => action('category', id, value), onRun: id => action('run', id), onRefresh: () => window.setTasks('ready'), onSignIn: () => window.calls.push({kind:'signin'}) });
host.append(view.element);
window.finish = (success = true) => { if (success) pending.resolve(false); else pending.reject(new Error('Fixture failure')); };
window.setTasks = (mode = 'ready') => {
 state = {state: mode === 'loading' ? 'loading' : ['error','signin','stale'].includes(mode) ? 'error' : 'ready', tasks: ['empty','loading','error','signin'].includes(mode) ? [] : tasks, page:'https://tasks.example/', needsSignIn: mode === 'signin', error: mode === 'signin' ? 'Sign in to see your tasks.' : mode === 'error' ? 'Task service returned HTTP 503. Try again later.' : mode === 'stale' ? 'Could not refresh. Showing the previous task list.' : ''};
 view.update(state);
};
const now = Date.parse('2026-11-14T16:00:00Z');
const raw = { timeZone:'America/New_York', updatedAt: new Date(now).toISOString(), items: [
 {id:'one',backgroundColor:'#4285f4',summary:'Design workshop',start:{dateTime:'2026-11-16T11:00:00-05:00'},end:{dateTime:'2026-11-16T12:00:00-05:00'}},
 {id:'two',backgroundColor:'#33b679',summary:'Principles of data management — discussion and review',start:{dateTime:'2026-11-16T12:30:00-05:00'},end:{dateTime:'2026-11-16T13:50:00-05:00'}},
 {id:'three',backgroundColor:'#8e24aa',summary:'Planning day',start:{date:'2026-11-17'},end:{date:'2026-11-18'}},
]};
let info;
const context = () => ({host, key:'fixture-' + generation, before:view.element, valid:()=>true});
info = createCalendarCard(document, {now:()=>now, wallNow:()=>now, schedule:()=>info.sync(context()), feed: {signIn:()=>window.calls.push({kind:'calendar-signin'}), load:async()=>{
 if (calendarState === 'loading') return new Promise(()=>{});
 if (calendarState === 'error' || calendarState === 'signin') throw Object.assign(new Error(calendarState === 'signin' ? 'Sign in to see your calendar.' : 'Calendar source needs setup.'), {status: calendarState === 'signin' ? 401 : 503});
 return normalizeAgenda({...raw, stale:calendarState === 'stale', items:calendarState === 'empty' ? [] : raw.items}, now);
}}});
window.setCalendar = mode => {calendarState = mode; generation++; info.sync(context());};
window.setTasks(); window.setCalendar('ready');
` }, bundle: true, write: false, format: "iife" });
const css = await readFile("src/styles/content.css", "utf8");
await writeFile("harness/out/assistant-widgets/index.html", `<!doctype html><html><meta charset="utf-8"><title>Assistant widgets — synthetic fixture</title><style>
:root{font-family:system-ui,sans-serif;font-size:16px;--background:#101010;--foreground:#e5e5e5;--muted-foreground:#a3a3a3;--border:#333;--accent:#262626;--ring:#a3a3a3;--destructive:#f87171;--secondary:#262626;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);padding:20px}body>p{font-size:11px;color:var(--muted-foreground);margin:0 0 12px}button,input,select{font:inherit}a{color:inherit}
${css}
#fixture{width:360px;height:680px;max-height:calc(100dvh - 64px);border:1px solid var(--border);border-radius:16px;overflow:auto;background:var(--background)}
</style><body><p>Synthetic fixture · real widget code · no personal data</p><div id="fixture"><div data-t3plus-tasks-host></div></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
console.log("Synthetic fixture: harness/out/assistant-widgets/index.html");
