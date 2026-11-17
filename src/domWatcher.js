/**
 * Runs `check` after DOM mutations and SPA navigations, at most once per
 * `throttleMs`. The observer callback only arms a timer, so heavy streaming in
 * the chat costs one cheap check per window, not one per mutation. No polling.
 * While the tab is hidden nothing is watched (a reply streaming into a
 * background tab costs nothing); showing it runs one check at once, before
 * Chrome paints the tab again.
 * `isNoise(node)`, when given, marks mutations t3+ never needs to react to
 * (text streaming into the message list): a batch made only of those is
 * dropped without scheduling a check.
 */
export function createDomWatcher({ win, doc, check, throttleMs, isNoise = null, attributeFilter = null }) {
  let timer = null;
  let observer = null;
  let running = false;
  let lastRun = -Infinity;
  // After a navigation, checks run without the throttle for a short burst, so
  // route changes (the glow moving, the home cards) follow T3 immediately.
  let burstUntil = -Infinity;
  const BURST_MS = 600;
  let hidden = false;
  const now = () => win.performance?.now?.() ?? Date.now();

  function run() {
    timer = null;
    lastRun = now();
    check();
  }

  function schedule() {
    // Late async work (a feed arriving after stop) must not revive a stopped app.
    if (!running || hidden || timer !== null) return;
    const wait = now() < burstUntil ? 0 : Math.max(0, throttleMs - (now() - lastRun));
    timer = win.setTimeout(run, wait);
  }

  const onNavigate = () => {
    burstUntil = now() + BURST_MS;
    if (timer !== null) {
      win.clearTimeout(timer);
      timer = null;
    }
    schedule();
  };

  const observe = () => observer.observe(doc.documentElement, { childList: true, subtree: true, ...(attributeFilter ? { attributes: true, attributeFilter } : {}) });
  const onVisibility = () => {
    const next = doc.visibilityState === "hidden";
    if (!running || next === hidden) return;
    hidden = next;
    if (hidden) {
      observer.disconnect();
      if (timer !== null) win.clearTimeout(timer);
      timer = null;
      return;
    }
    observe();
    run();
  };

  return {
    start() {
      running = true;
      hidden = doc.visibilityState === "hidden";
      observer = new win.MutationObserver((records) => {
        if (isNoise && records.every((record) => isNoise(record.target))) return;
        schedule();
      });
      if (!hidden) observe();
      // T3 uses client-side routing. The Navigation API sees pushState too;
      // popstate covers back/forward where it is missing.
      win.navigation?.addEventListener?.("currententrychange", onNavigate);
      win.addEventListener("popstate", onNavigate);
      doc.addEventListener("visibilitychange", onVisibility);
      run();
    },
    stop() {
      running = false;
      observer?.disconnect();
      observer = null;
      win.navigation?.removeEventListener?.("currententrychange", onNavigate);
      win.removeEventListener("popstate", onNavigate);
      doc.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) win.clearTimeout(timer);
      timer = null;
    },
    schedule,
    /** Runs a pending check now. For tests and for state changes that should show immediately. */
    flush() {
      if (timer !== null) win.clearTimeout(timer);
      run();
    },
  };
}
