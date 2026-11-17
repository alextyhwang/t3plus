import { createBuilder } from "./dom.js";
import { CALENDAR_PAGE } from "./calendar.js";

const REFRESH_COOLDOWN_MS = 30 * 1000;
const TTL_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 60 * 1000;

/** The read-only calendar card, with a fresh request lifetime per host/draft. */
export function createCalendarCard(doc, { feed, schedule, now = Date.now, wallNow = Date.now } = {}) {
  const h = createBuilder(doc);
  const element = h("div", { class: "t3plus-assistant-info", "data-t3plus-assistant-info": "" });
  let state = {};
  let epoch = 0, context = null, signature = "", selectedDay = null;
  const shiftDay = (day, delta) => new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
  function reset() {
    epoch++; context = null; signature = ""; selectedDay = null; state = {}; element.replaceChildren(); element.remove();
  }
  function render() {
    const currentTime = wallNow();
    const next = JSON.stringify(state) + selectedDay + Math.floor(currentTime / 60000) + (now() - (state.attempt ?? -Infinity) >= REFRESH_COOLDOWN_MS);
    if (signature === next) return;
    signature = next;
    const active = element.contains(doc.activeElement) ? doc.activeElement : null;
    const refreshFocus = active?.getAttribute("data-info-refresh");
    const signInFocus = active?.hasAttribute("data-info-signin");
    const linkFocus = active?.tagName === "A" ? active.href : null;
    const dayFocus = active?.getAttribute("data-info-day");
    const agendaFocus = active?.matches(".t3plus-info-agenda");
    const agendaScroll = element.querySelector(".t3plus-info-agenda")?.scrollTop ?? 0;
    element.replaceChildren();
    const data = state.data;
    const section = h("section", { class: "t3plus-info-card t3plus-info-calendar", "aria-label": "Upcoming calendar events" });
    const actions = h("div", { class: "t3plus-info-actions" }, [
      h("button", { type: "button", "data-info-refresh": "calendar", disabled: state.loading || now() - (state.attempt ?? -Infinity) < REFRESH_COOLDOWN_MS,
        "aria-label": "Refresh calendar", title: "Refresh calendar", text: "↻" }),
      h("a", { href: CALENDAR_PAGE, target: "_blank", rel: "noopener noreferrer", text: "Open calendar" }),
    ]);
    const heading = h("h3", { text: "Calendar" });
    section.append(h("header", {}, [heading, actions]));
    if (data) {
      const today = data.today, horizon = data.horizon;
      const onDay = day => data.events.filter(event => event.day <= day && (event.lastDay ?? event.day) >= day);
      if (!selectedDay || selectedDay < today || selectedDay > horizon) {
        selectedDay = onDay(today).length ? today : data.events.find(event => event.day > today)?.day ?? today;
      }
      const date = new Date(`${selectedDay}T12:00:00Z`);
      const dateLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(date);
      const snapshot = data.updated == null ? "" : ` · As of ${new Intl.DateTimeFormat(undefined, { timeZone: data.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(data.updated)}`;
      const refresh = actions.querySelector("button");
      refresh.title = `Refresh calendar · ${data.timeZone}${snapshot}`;
      refresh.setAttribute("aria-description", data.timeZone + snapshot);
      const calendarLink = actions.querySelector("a");
      calendarLink.replaceChildren(h("time", { datetime: selectedDay, text: dateLabel, "aria-live": "polite" }));
      calendarLink.title = "Open calendar";
      calendarLink.setAttribute("aria-label", `${dateLabel}, open calendar`);
      const clock = new Intl.DateTimeFormat(undefined, { timeZone: data.timeZone, hour: "numeric", minute: "2-digit" }).format(currentTime);
      heading.replaceChildren(calendarLink, h("span", { class: "t3plus-info-clock" }, [
        h("time", { datetime: new Date(currentTime).toISOString(), text: `Now ${clock}`, title: data.timeZone, "aria-label": `Current time in ${data.timeZone}: ${clock}` }),
        data.stale ? h("span", { text: " · Stale" }) : null,
      ]));
      actions.classList.add("t3plus-info-day-nav");
      actions.prepend(
        h("button", { type: "button", "data-info-day": "-1", "aria-label": "Previous day", title: "Previous day", disabled: selectedDay <= today, text: "‹" }),
        h("button", { type: "button", "data-info-day": "1", "aria-label": "Next day", title: "Next day", disabled: selectedDay >= horizon, text: "›" }),
      );
      const events = onDay(selectedDay);
      const list = h("ol", { class: "t3plus-info-agenda", tabindex: "0", "aria-label": `Events for ${dateLabel}` });
      for (const event of events) {
        const time = event.when.split(" · ").slice(1).join(" · ");
        const body = h("div", { class: "t3plus-info-event-body" }, [
          h("span", { class: "t3plus-info-event", text: event.title, title: event.title }),
          h("span", { class: "t3plus-info-meta", text: time, title: `${event.when} (${data.timeZone})` }),
        ]);
        if (event.color) body.style.borderLeftColor = event.color;
        list.append(h("li", {}, [body]));
      }
      section.append(events.length ? list : h("p", { class: "t3plus-info-message", text: data.stale || state.error ? "No events for this day in the stale snapshot." : "No upcoming events for this day." }));
    }
    if (!data || state.error) section.append(h("p", { class: "t3plus-info-message", role: "status", text: state.error ? `${data ? "Stale · " : ""}${state.error}` : "Loading…" }));
    if (state.signIn && feed.signIn) section.append(h("button", { type: "button", "data-info-signin": "", text: "Sign in with passkey" }));
    section.setAttribute("aria-busy", state.loading ? "true" : "false");
    element.append(section);
    if (refreshFocus) element.querySelector(`[data-info-refresh="${refreshFocus}"]`)?.focus();
    else if (signInFocus) element.querySelector("[data-info-signin]")?.focus();
    else if (linkFocus) [...element.querySelectorAll("a")].find(link => link.href === linkFocus)?.focus();
    else if (dayFocus) {
      const control = element.querySelector(`[data-info-day="${dayFocus}"]`);
      (control?.disabled ? element.querySelector("[data-info-day]:not(:disabled)") : control)?.focus();
    }
    else if (agendaFocus) element.querySelector(".t3plus-info-agenda")?.focus();
    const agenda = element.querySelector(".t3plus-info-agenda");
    if (agenda) agenda.scrollTop = agendaScroll;
  }
  function sync(next) {
    if (!next?.host || !next.key) { if (context) reset(); return; }
    if (context?.key !== next.key || context?.host !== next.host) { reset(); context = next; }
    else context = next;
    if (element.parentElement !== next.host || element.nextElementSibling !== (next.before ?? null)) next.host.insertBefore(element, next.before ?? null);
    state.attempt ??= -Infinity;
    if (doc.visibilityState !== "hidden" && !state.loading && now() - state.attempt >= (state.error ? ERROR_RETRY_MS : TTL_MS)) {
      const attempt = state;
      attempt.loading = true; attempt.attempt = now();
      const generation = epoch, key = context.key, host = context.host;
      const current = () => generation === epoch && context?.key === key && context.host === host && host.isConnected && context.valid();
      Promise.resolve().then(() => current() ? feed.load() : undefined).then(data => {
        if (!current() || !data) return;
        state = { ...attempt, loading: false, data, error: "", signIn: false }; schedule();
      }).catch(error => {
        if (!current()) return;
        // Authentication failure discards personal payloads immediately.
        if (error.status === 401) selectedDay = null;
        state = { ...attempt, loading: false, data: error.status === 401 ? null : attempt.data, error: error.message || "Could not refresh.", signIn: error.status === 401 }; schedule();
      });
    }
    render();
  }
  async function click(event) {
    const day = event.target.closest("[data-info-day]");
    if (day && !day.disabled && selectedDay) {
      selectedDay = shiftDay(selectedDay, Number(day.dataset.infoDay));
      element.querySelector(".t3plus-info-agenda")?.scrollTo?.(0, 0);
      render();
    }
    const refresh = event.target.closest("[data-info-refresh]");
    if (refresh && !refresh.disabled) {
      if (now() - state.attempt >= REFRESH_COOLDOWN_MS) { state.attempt = -Infinity; schedule(); }
    }
    const signIn = event.target.closest("[data-info-signin]");
    if (signIn && !signIn.disabled) {
      const generation = epoch;
      signIn.disabled = true;
      try { await feed.signIn(); } catch { if (generation === epoch) { state.error = "Could not open sign-in. Use Open calendar or try again."; schedule(); } }
      finally { if (generation === epoch) signIn.disabled = false; }
    }
  }
  element.addEventListener("click", click);
  return { element, sync, reset, focus() {
    if (state.signIn) state.attempt = -Infinity;
  }, destroy() { reset(); element.removeEventListener("click", click); } };
}
