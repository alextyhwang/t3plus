// What the live tools share: argument parsing, a Chrome DevTools Protocol
// client for General agent Chrome, and a polling wait. They never connect to
// the personal browser.
import assert from "node:assert/strict";
import { T3_SELECTORS } from "../src/config.js";

/** General agent Chrome's debugging port, the only browser these tools drive. */
export const AGENT_CHROME_PORT = "9334";

/** Page-side selectors, quoted for use inside evaluated expressions. */
export const SELECTOR = Object.freeze({
  detailsCard: JSON.stringify(T3_SELECTORS.threadDetailsCard),
  draftProjectTrigger: JSON.stringify(T3_SELECTORS.draftProjectTrigger),
  conversation: JSON.stringify(T3_SELECTORS.conversationArea),
  composerSurface: JSON.stringify(T3_SELECTORS.composerSurface),
  composerShell: JSON.stringify(T3_SELECTORS.composerShell),
  composerHost: JSON.stringify(T3_SELECTORS.composerHost),
  composerMainSurface: JSON.stringify(T3_SELECTORS.composerMainSurface),
  /** T3's details-panel toggle. The extension never uses it, so it is not in src/config.js. */
  detailsToggle: JSON.stringify('button[aria-label="Toggle thread details panel"]'),
});

/** `--name value` pairs from the command line. */
export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.flatMap((arg, index) => (arg.startsWith("--") ? [[arg.slice(2), argv[index + 1]]] : [])));
}

/**
 * Connects to the browser endpoint (http://127.0.0.1:9334). `send` resolves
 * with a command's result; `listeners` receive every event message.
 */
export async function connectCdp(url, { timeoutMs = 15000 } = {}) {
  assert.equal(typeof WebSocket, "function", "The live tools require Node 22 or newer");
  const endpoint = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(endpoint.hostname), "Only a local agent Chrome is supported");
  assert.equal(endpoint.port, AGENT_CHROME_PORT, "Only General agent Chrome is supported");
  const { webSocketDebuggerUrl } = await (await fetch(new URL("/json/version", endpoint))).json();
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (!message.id) {
      for (const listener of listeners) listener(message);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`CDP ${request.method} failed`));
    else request.resolve(message.result);
  });
  return {
    listeners,
    send(method, params = {}, sessionId) {
      const n = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(n);
          reject(new Error(`CDP ${method} timed out`));
        }, timeoutMs);
        pending.set(n, { resolve, reject, timer, method });
        socket.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() {
      for (const request of pending.values()) clearTimeout(request.timer);
      pending.clear();
      socket.close();
    },
  };
}

/** Polls `check` until it returns something truthy, which it returns. */
export async function wait(check, label, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out: ${label}`);
}
