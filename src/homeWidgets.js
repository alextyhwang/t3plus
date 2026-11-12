import { T3PLUS } from "./config.js";
import { createTooltip } from "./homeTooltip.js";
import { createBuilder } from "./dom.js";
import { createDitherCanvas } from "./ditherChart.js";
import { dailyActivity, formatPercent, formatTokens, formatUsd, heatmap, poolModel, profileProjectSet, tokenDaily, tokenSeries } from "./homeData.js";

// Home widgets under T3's new-thread composer: four compact cards in a 2x2
// grid, exactly as wide as T3's composer.
//   Codex pool / Claude pool  a compact pool chart: what is left
//                             this week, the recorded line, the dashed "as usual"
//                             projection with weekly refills, a red band where
//                             it would run out, and a Now marker.
//   Activity                  an activity graph (AI tokens per day),
//                             20 weeks, with weekday and month labels.
//   Usage                     T3's own usage chart (apps/web/src/components/usage/
//                             UsageProviderChart.tsx): one line per provider with a
//                             12% fill, border gridlines, tiny uppercase axis labels.
// Type and color follow T3: text-sm/medium headings, muted secondary text,
// tabular numbers, Codex in --contrast-foreground, Claude in #d97757.
// Plot geometry stays SVG for stable hit-testing; the visible area and line are
// painted by ditherChart.js as a Bayer dither gradient on the same pixel grid
// as the backdrop. The SVG fills remain the fallback when there is no canvas.

const SVG_NS = "http://www.w3.org/2000/svg";

// Lucide icons (ISC), the icon set T3 uses.
const ICONS = {
  activity: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
};

export const PROVIDER_COLORS = {
  codex: "var(--contrast-foreground, var(--foreground))",
  claude: "#d97757",
  grok: "color-mix(in oklab, var(--contrast-foreground, var(--foreground)) 72%, var(--background))",
  cursor: "#8b8b8b",
  opencode: "#5b9bbd",
  antigravity: "#8c7bd1",
  pi: "#4d9f8a",
};
const PROVIDER_LABELS = { codex: "Codex", claude: "Claude", grok: "Grok", cursor: "Cursor", opencode: "OpenCode", antigravity: "Antigravity", pi: "Pi" };
/** Pool line colors: blue for Codex, T3's Claude orange for Claude. */
const POOL_COLORS = { codex: "#6f9cf5", claude: "#d97757" };

/** Heatmap length: 20 weeks (the feed carries 140 days). */
export const HEAT_WEEKS = 20;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDay = (key) => {
  const [, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const fmtWhen = (ms, now) => {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${DAYS[d.getDay()]} ${time}`;
};

/**
 * The home widgets. `variant: "pool"` is a single pool card (Codex or Claude,
 * `model.kind`) for T3's thread details panel; the default is the home grid.
 */
export function createHomeView(doc, { variant = "home" } = {}) {
  const h = createBuilder(doc);
  const svgEl = (tag, attrs = {}) => {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const icon = (name) => {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "t3plus-w-icon" });
    svg.innerHTML = ICONS[name];
    return svg;
  };
  const card = (name, title, iconName, aside, body) =>
    h("section", { class: `t3plus-w t3plus-w-${name}`, "aria-label": title }, [
      h("header", { class: "t3plus-w-head" }, [icon(iconName), h("h3", { text: title }), aside ? h("span", { class: "t3plus-w-aside" }, aside) : null]),
      ...[].concat(body),
    ]);
  const empty = (message) => h("p", { class: "t3plus-w-empty", text: message });

  const element =
    variant === "pool"
      ? h("div", { class: "t3plus-details-pool", "data-t3plus-owned": "" })
      : h("div", { id: T3PLUS.homeId, class: "t3plus-home", "data-t3plus-owned": "" });
  let signature = "";

  // ---------------- Hover: T3-style tooltip + a crosshair on the charts ----------------
  // Cards register what to show; one delegated pointer handler on t3+'s own
  // grid drives everything (no listeners on T3's DOM).
  const tip = createTooltip(doc);
  const cellTips = new WeakMap(); // heatmap cell -> tooltip content
  const plotHovers = new WeakMap(); // chart plot -> (fraction 0..1) => { frac, content, dots: [{ y, color }] }
  let marked = null;
  let dithers = []; // the current cards' dither canvases
  const dither = (series) => {
    const d = createDitherCanvas(doc, series);
    dithers.push(d);
    return d.canvas;
  };

  function clearMarker() {
    marked?.querySelector(":scope > .t3plus-w-hover")?.removeAttribute("data-on");
    marked = null;
  }

  function showMarker(plot, hit) {
    let marker = plot.querySelector(":scope > .t3plus-w-hover");
    if (!marker) {
      marker = h("div", { class: "t3plus-w-hover", "aria-hidden": "true" }, [h("span", { class: "t3plus-w-hover-line" })]);
      plot.append(marker);
    }
    marker.style.left = `${(hit.frac * 100).toFixed(2)}%`;
    const dots = [...marker.querySelectorAll(".t3plus-w-hover-dot")];
    hit.dots.forEach((d, i) => {
      const dot = dots[i] ?? marker.appendChild(h("span", { class: "t3plus-w-hover-dot" }));
      dot.style.top = `${(d.y * 100).toFixed(2)}%`;
      dot.style.background = d.color;
    });
    for (const extra of dots.slice(hit.dots.length)) extra.remove();
    if (marked && marked !== plot) clearMarker();
    marker.setAttribute("data-on", "");
    marked = plot;
  }

  function onPointerMove(event) {
    const target = event.target;
    const cell = target?.closest?.(".t3plus-w-cell");
    if (cell && cellTips.has(cell)) {
      clearMarker();
      const r = cell.getBoundingClientRect();
      tip.show({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom }, cellTips.get(cell));
      return;
    }
    const plot = target?.closest?.(".t3plus-w-plot");
    const hover = plot && plotHovers.get(plot);
    if (!hover) {
      clearMarker();
      tip.hide();
      return;
    }
    const r = plot.getBoundingClientRect();
    const hit = hover(r.width > 0 ? Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) : 1);
    if (!hit) return;
    showMarker(plot, hit);
    tip.show({ x: r.left + hit.frac * r.width, top: r.top, bottom: r.bottom }, hit.content);
  }

  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerleave", () => {
    clearMarker();
    tip.hide();
  });

  // ---------------- Pool (Codex / Claude) ----------------

  function poolCard(feed, kind, now) {
    const title = kind === "codex" ? "Codex pool" : "Claude pool";
    const pool = poolModel(feed, kind, now.getTime());
    if (!pool) return card(`pool t3plus-w-${kind}`, title, "gauge", null, [empty(feed ? "No limits reported." : "Waiting for the home feed…")]);
    const color = POOL_COLORS[kind];
    const W = 300;
    const H = 72;
    const x = (t) => ((t - pool.from) / (pool.until - pool.from)) * W;
    const y = (v) => H - 1 - (Math.max(0, Math.min(pool.cap, v)) / pool.cap) * (H - 8);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "t3plus-w-plot-svg", "data-t3plus-dither-chart": "area", "aria-hidden": "true" });
    svg.style.setProperty("--pool-color", color);
    // "Weeks used up": where the projection sits at zero.
    let bandStart = null;
    for (const p of [...pool.projected, { t: Infinity, left: 1 }]) {
      if (p.left <= 0 && bandStart === null) bandStart = p.t;
      if (p.left > 0 && bandStart !== null) {
        const end = Math.min(p.t, pool.until);
        svg.append(svgEl("rect", { x: x(bandStart).toFixed(1), y: 0, width: Math.max(1, x(end) - x(bandStart)).toFixed(1), height: H, class: "t3plus-w-band" }));
        bandStart = null;
      }
    }
    svg.append(svgEl("path", { d: `M0 ${y(pool.cap / 2)}H${W}M0 ${H - 0.5}H${W}`, class: "t3plus-w-grid" }));
    const line = (points) => points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.left).toFixed(1)}`).join("");
    const area = (points) => `${line(points)}L${x(points.at(-1).t).toFixed(1)} ${H}L${x(points[0].t).toFixed(1)} ${H}Z`;
    if (pool.recorded.length > 1) {
      svg.append(svgEl("path", { d: area(pool.recorded), class: "t3plus-w-area" }));
      svg.append(svgEl("path", { d: line(pool.recorded), class: "t3plus-w-line", "vector-effect": "non-scaling-stroke" }));
    }
    svg.append(svgEl("path", { d: area(pool.projected), class: "t3plus-w-area t3plus-w-area-projected" }));
    svg.append(svgEl("path", { d: line(pool.projected), class: "t3plus-w-line t3plus-w-line-projected", "vector-effect": "non-scaling-stroke" }));
    svg.append(svgEl("path", { d: `M${x(pool.now).toFixed(1)} 0V${H}`, class: "t3plus-w-now", "vector-effect": "non-scaling-stroke" }));

    const pct = (t) => `${((x(t) / W) * 100).toFixed(2)}%`;
    const overlays = [h("span", { class: "t3plus-w-now-label", style: `left:${pct(pool.now)}`, text: "Now" })];
    // Refill labels, skipping ones that would overlap.
    let lastX = -Infinity;
    for (const r of pool.refills) {
      if (r.amount < pool.cap * 0.04 || x(r.at) - lastX < 34) continue;
      lastX = x(r.at);
      overlays.push(h("span", { class: "t3plus-w-refill", style: `left:${pct(r.at)}`, text: `+${formatPercent(r.amount)}` }));
    }
    const ticks = [];
    const first = new Date(pool.from);
    first.setHours(24, 0, 0, 0);
    for (let t = first.getTime(); t < pool.until; t += 86400000) {
      if (x(t) < 12 || x(t) > W - 12) continue;
      ticks.push(h("span", { style: `left:${pct(t)}`, text: DAYS[new Date(t).getDay()] }));
    }
    const frac = (points) => points.map((p) => [x(p.t) / W, y(p.left) / H]);
    const poolDither = dither([
      ...(pool.recorded.length > 1 ? [{ points: frac(pool.recorded), color, fillAlpha: 0.85 }] : []),
      { points: frac(pool.projected), color, fillAlpha: 0.4, lineAlpha: 0.8, dashed: true },
    ]);
    const poolPlot = h("div", { class: "t3plus-w-plot", role: "img", "aria-label": `${title}: ${formatPercent(pool.left)} left of ${formatPercent(pool.cap)} this week${pool.runsOutAt ? `, runs out ${fmtWhen(pool.runsOutAt, pool.now)} at the usual pace` : ""}` }, [poolDither, svg, ...overlays]);
    const points = [...pool.recorded.map((p) => ({ ...p, projected: false })), ...pool.projected.slice(1).map((p) => ({ ...p, projected: true }))];
    plotHovers.set(poolPlot, (frac) => {
      const t = pool.from + frac * (pool.until - pool.from);
      let best = points[0];
      for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      if (!best) return null;
      const refill = pool.refills.find((r) => Math.abs(r.at - best.t) <= 30 * 60000);
      return {
        frac: x(best.t) / W,
        dots: [{ y: y(best.left) / H, color }],
        content: {
          label: `${fmtWhen(best.t, pool.now)}${best.t === pool.now ? " · now" : best.projected ? " · projected" : ""}`,
          rows: [
            { name: "Left", value: `${formatPercent(best.left)} of ${formatPercent(pool.cap)}`, color },
            ...(refill ? [{ name: "Weekly reset", value: `+${formatPercent(refill.amount)}` }] : []),
            ...(best.projected && best.left <= 0 ? [{ name: "Status", value: "Week used up" }] : []),
          ],
        },
      };
    });
    const status = pool.runsOutAt
      ? h("span", { class: "t3plus-w-warn", text: `Runs out ${fmtWhen(pool.runsOutAt, pool.now)}` })
      : h("span", { class: "t3plus-w-muted", text: "Lasts the week" });
    return card(`pool t3plus-w-${kind}`, title, "gauge", [status], [
      h("div", { class: "t3plus-w-pool-head" }, [
        h("span", { class: "t3plus-w-big-num", text: formatPercent(pool.left) }),
        h("span", { class: "t3plus-w-muted", text: `left of ${formatPercent(pool.cap)}` }),
        pool.nextRefill ? h("span", { class: "t3plus-w-next", title: "Next weekly reset" }, [`+${formatPercent(pool.nextRefill.amount)} `, h("span", { class: "t3plus-w-muted", text: fmtWhen(pool.nextRefill.at, pool.now) })]) : null,
      ]),
      poolPlot,
      h("div", { class: "t3plus-w-axis" }, ticks),
    ]);
  }

  // ---------------- Activity ----------------

  // Fills its card: a weekday column (Mon / Wed / Fri), month labels on top,
  // and one square per day, scaled to the card's width.
  function activityCard(feed, projects, now) {
    if (!feed) return card("activity", "Activity", "activity", null, [empty("Waiting for the home feed…")]);
    // The activity source's numbers (AI tokens per day) when the feed has them; T3 turns otherwise.
    const tokens = feed.aiActivity.size > 0;
    const daily = tokens ? tokenDaily(feed) : dailyActivity(feed, projects);
    const map = heatmap(daily, now, HEAT_WEEKS);
    const unit = tokens ? "tokens" : "turns";
    const amount = (v) => (tokens ? formatTokens(v) : v.toLocaleString("en-US"));
    const grid = h("div", { class: "t3plus-w-heat", role: "img", "aria-label": `Activity: ${amount(map.runs)} ${unit} over the last ${HEAT_WEEKS} weeks` });
    grid.style.setProperty("--weeks", String(HEAT_WEEKS));
    const place = (el, col, row) => {
      el.style.gridColumn = String(col);
      el.style.gridRow = String(row);
      return el;
    };
    for (const [row, label] of [[3, "Mon"], [5, "Wed"], [7, "Fri"]]) grid.append(place(h("span", { class: "t3plus-w-heat-day", text: label }), 1, row));
    let lastMonth = -1;
    let lastLabel = -Infinity;
    map.columns.forEach((column, w) => {
      // The month of the week's last day, so a label sits on the month's first full week.
      const month = Number(column[6].key.slice(5, 7)) - 1;
      if (month !== lastMonth && w - lastLabel >= 3 && w < HEAT_WEEKS - 1) {
        grid.append(place(h("span", { class: "t3plus-w-heat-month", text: MONTHS[month] }), w + 2, 1));
        lastLabel = w;
      }
      lastMonth = month;
      column.forEach((cell, d) => {
        const el = h("span", { class: "t3plus-w-cell", "data-level": String(cell.level) });
        if (cell.future) el.setAttribute("data-future", "");
        if (cell.today) el.setAttribute("data-today", "");
        if (!cell.future) {
          const providers = Object.entries(daily.get(cell.key)?.providers ?? {}).sort((a, b) => b[1] - a[1]);
          cellTips.set(el, {
            label: `${DAYS[new Date(`${cell.key}T12:00:00`).getDay()]}, ${fmtDay(cell.key)}`,
            rows: providers.map(([p, n]) => ({ name: PROVIDER_LABELS[p] ?? p, value: formatTokens(n), color: PROVIDER_COLORS[p] ?? "var(--muted-foreground)" })),
            total: { name: tokens ? "Total" : "Turns", value: cell.runs ? amount(cell.runs) : "No activity" },
          });
        }
        grid.append(place(el, w + 2, d + 2));
      });
    });
    return card("activity", "Activity", "activity", [h("span", { class: "t3plus-w-muted", text: `${amount(map.runs)} ${unit}` })], [grid]);
  }

  // ---------------- Usage (T3's chart) ----------------

  function usageCard(feed, now) {
    if (!feed) return card("usage", "Usage", "chart", null, [empty("Waiting for the home feed…")]);
    const { days, series, month } = tokenSeries(feed, now, 14);
    if (!series.length) return card("usage", "Usage", "chart", null, [empty("No usage recorded in the last two weeks.")]);
    const W = 300;
    const H = 72;
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const step = W / (days.length - 1);
    const y = (v) => H - (v / max) * (H - 6);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "t3plus-w-plot-svg", "data-t3plus-dither-chart": "line", "aria-hidden": "true" });
    svg.append(svgEl("path", { d: `M0 ${y(max)}H${W}M0 ${y(max / 2)}H${W}M0 ${H - 0.5}H${W}`, class: "t3plus-w-grid" }));
    for (const s of series) {
      const line = s.values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join("");
      const area = svgEl("path", { d: `${line}L${W} ${H}L0 ${H}Z`, fill: PROVIDER_COLORS[s.provider] ?? "var(--muted-foreground)", "fill-opacity": "0.12" });
      const stroke = svgEl("path", { d: line, fill: "none", stroke: PROVIDER_COLORS[s.provider] ?? "var(--muted-foreground)", "stroke-width": "2", "vector-effect": "non-scaling-stroke" });
      svg.append(area, stroke);
    }
    const legend = Object.entries(month)
      .filter(([, v]) => v.tokens > 0)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 3)
      .map(([p, v]) =>
        h("span", { class: "t3plus-w-legend-item", title: `${PROVIDER_LABELS[p] ?? p} this month: ${formatTokens(v.tokens)} tokens, ${formatUsd(v.cost)}` }, [
          h("span", { class: "t3plus-w-legend-dot", style: `background:${PROVIDER_COLORS[p] ?? "var(--muted-foreground)"}` }),
          `${PROVIDER_LABELS[p] ?? p} ${formatTokens(v.tokens)}`,
        ]));
    const totalCost = Object.values(month).reduce((n, v) => n + v.cost, 0);
    const label = (key) => fmtDay(key).toUpperCase();
    // Largest series first, so a smaller one stays visible on top of it.
    const usageDither = dither([...series]
      .sort((a, b) => b.values.reduce((n, v) => n + v, 0) - a.values.reduce((n, v) => n + v, 0))
      .map((s) => ({ points: s.values.map((v, i) => [i / (days.length - 1), y(v) / H]), color: PROVIDER_COLORS[s.provider] ?? "var(--muted-foreground)", fillAlpha: 0.75 })));
    const usagePlot = h("div", { class: "t3plus-w-plot", role: "img", "aria-label": `Tokens per day by provider, last ${days.length} days` }, [usageDither, svg]);
    plotHovers.set(usagePlot, (frac) => {
      const i = Math.round(frac * (days.length - 1));
      const key = days[i];
      const spend = Object.values(feed.spend.get(key) ?? {}).reduce((n, [cost]) => n + cost, 0);
      const total = series.reduce((n, s) => n + s.values[i], 0);
      return {
        frac: i / (days.length - 1),
        dots: series.map((s) => ({ y: y(s.values[i]) / H, color: PROVIDER_COLORS[s.provider] ?? "var(--muted-foreground)" })),
        content: {
          label: `${DAYS[new Date(`${key}T12:00:00`).getDay()]}, ${fmtDay(key)}`,
          rows: [...series].sort((a, b) => b.values[i] - a.values[i]).map((s) => ({ name: PROVIDER_LABELS[s.provider] ?? s.provider, value: formatTokens(s.values[i]), color: PROVIDER_COLORS[s.provider] ?? "var(--muted-foreground)" })),
          total: { name: "Total", value: `${formatTokens(total)} · ${formatUsd(spend)}` },
        },
      };
    });
    return card("usage", "Usage", "chart", [h("span", { class: "t3plus-w-muted", text: `${formatUsd(totalCost)} this month` })], [
      h("div", { class: "t3plus-w-usage-plot" }, [
        h("div", { class: "t3plus-w-yaxis" }, [h("span", { text: formatTokens(max) }), h("span", { text: "0" })]),
        usagePlot,
      ]),
      h("div", { class: "t3plus-w-axis t3plus-w-axis-spread" }, [h("span", { text: label(days[0]) }), h("span", { text: label(days[Math.floor(days.length / 2)]) }), h("span", { text: label(days.at(-1)) })]),
      h("div", { class: "t3plus-w-legend" }, legend),
    ]);
  }

  return {
    element,
    /** @param {{ feed, profile: object | null, now?: Date }} model */
    update(model) {
      const now = model.now ?? new Date();
      const minute = Math.floor(now.getTime() / 60000);
      const next = JSON.stringify([model.feed?.generatedAt ?? null, model.profile?.id ?? null, model.kind ?? null, minute]);
      if (next === signature) {
        // Same cards: repaint only if the pixel size or layout changed (a no-op otherwise).
        for (const d of dithers) d.paint();
        return false;
      }
      signature = next;
      tip.hide();
      marked = null;
      for (const d of dithers) d.disconnect();
      dithers = [];
      if (variant === "pool") {
        element.replaceChildren(poolCard(model.feed, model.kind === "codex" ? "codex" : "claude", now));
        return true;
      }
      const projects = model.feed ? profileProjectSet(model.feed, model.profile) : new Set();
      element.replaceChildren(poolCard(model.feed, "codex", now), poolCard(model.feed, "claude", now), activityCard(model.feed, projects, now), usageCard(model.feed, now));
      return true;
    },
    /** Removes the tooltip from <body> (t3+ stopped). */
    destroy() {
      for (const d of dithers) d.disconnect();
      dithers = [];
      tip.remove();
    },
  };
}
