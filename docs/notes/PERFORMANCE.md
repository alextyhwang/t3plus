# What t3+ costs a T3 tab (2026-11-17)

Measured with `harness/perf.mjs` on the harness fixture, in Playwright's
Chromium 1248 (headless, software compositing, 1333x959 at 1.5x), on a Windows desktop.

```
npm run build
CHROME=~/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe npm run perf -- --runs 3 --out perf.json
npm run perf -- --bare        # the fixture alone: content.js served empty
```

## The session

One thread page with the glow, glass, three bots (one working, one needing
you), the Assistant group and tasks. Each phase is measured on its own:

| phase | what happens |
|---|---|
| load | open the thread page, wait 4 s |
| idle | 12 s, nothing happens |
| stream | 12 s of a reply streaming into `.messages-timeline-scroll` (30 tokens/s, autoscroll, a new paragraph every 10 tokens) plus a status line outside the list ticking every second |
| hidden | the same stream for 12 s with the tab hidden |
| return | 3 s after the tab shows again |
| navigate | 4 client-side route changes, one per second |
| draft | open the new-thread page (home widgets, tasks), wait 12 s |
| reload | open the thread page again |

Intervals of 30 s or more run 20 times faster, so a 60 s feed poll fires every
3 s and each 12 s phase covers four bot-feed polls. Counts come from wrappers
installed before any page script (observers, timers, layout reads, storage,
Chrome Sync, runtime messages, canvas encodes) and from V8 call counts
(`checkDom`, `glowPixelArt`, ...). Times are Chrome's own `Performance.getMetrics`
deltas (`TaskDuration` = all main-thread work, including style, layout and paint)
and the CPU profile time under `content.js`. Medians of 3 runs.

Headless Chromium never hides a tab, so the session overrides
`document.visibilityState` and fires `visibilitychange`; the page keeps
rendering, so "hidden" counts t3+'s own work, not Chrome's throttling. GPU cost
(backdrop-filter, compositing) is not measured: the run uses software compositing.

## Baseline (before the fixes)

Main-thread time per phase, ms (`TaskDuration`):

| phase | fixture alone | with t3+ | t3+ adds |
|---|---|---|---|
| load | 60 | 277 | 216 |
| idle (12 s) | 4.6 | 86 | 82 |
| stream (12 s) | 132 | 197 | 65 |
| hidden (12 s) | 151 | 201 | 50 |
| draft | 22 | 356 | 335 |
| reload | 13 | 196 | 183 |

## Hot spots, by measured cost

1. **Bot face animation: 60 style recalcs a second for as long as a bot works or
   needs you.** The faces stepped a sprite sheet with a `background-position`
   keyframe animation. Chrome cannot run that on the compositor, so it
   recalculated style every frame (729 recalcs in 12 idle seconds, 0 without
   t3+), though the face changes only every 175-200 ms. About 7 ms of main-thread
   work a second, every second, plus a 60 fps main-frame loop.
2. **The glow rendered twice on every page load.** The first DOM check runs
   before the wallpaper URL is set; the glow's render key included that URL
   (and the pane size), which the glow never draws. Two extra sprite renders and
   PNG encodes per load, about 50 ms.
3. **DOM checks kept running in hidden tabs.** A reply streaming into a
   background tab ran 17 checks in 12 s (119 layout reads, 72 style reads).
4. **Feed caches rewritten on every poll.** Each bot-feed poll (every minute) and
   home-feed poll (every 2 minutes) wrote its cache even when the text was the
   same: a storage write and 8 `storage.onChanged` callbacks in every T3 tab.
5. **Chrome Sync rewritten on every page load.** `mirrorToSync` pushed every
   synced key (settings, bots, profile view, local config) on each page load and
   in each tab, unchanged or not, and rewrote the page-storage copy.

## Fixes and their numbers

| fix | metric | before | after |
|---|---|---|---|
| 1. Animated faces are animated PNGs (`src/apng.js`); Chrome plays them off the main thread | idle main-thread ms / 12 s | 86.4 | 16.4 |
| | idle style recalcs / 12 s | 729 | 8 |
| | stream style recalcs / 12 s | 779 | 56 |
| | load style recalcs | 245 | 8 |
| 2. Glow render key holds only what the render reads | glow renders per page load | 2 | 1 |
| | t3+ script ms, load / draft / reload | 165 / 197 / 134 | 112 / 132 / 79 |
| | main-thread ms, draft / reload | 284 / 162 | 210 / 108 |
| 3. No DOM checks while hidden; one synchronous check on show | checkDom while hidden / 12 s | 16 | 0 |
| | t3+ script ms while hidden | 6.9 | 0 |
| | layout + style reads while hidden | 112 + 67 | 0 + 0 |
| 4. Unchanged feed polls are not written | storage writes, idle / 12 s (4 polls) | 4 | 0 |
| | onChanged callbacks, idle / draft | 32 / 72 | 0 / 16 |
| 5. Sync and the page copy are written only when a value differs | Sync items written per reload | 3 (446 B) | 1 (65 B: the profile view, which did change) |
| | page-storage writes per reload | 8 | 6 |

Before/after for each fix are consecutive commits on the branch, measured the
same way; the "before" of each fix is the "after" of the previous one.

All together (main-thread ms that t3+ adds over the fixture alone):

| phase | before | after | change |
|---|---|---|---|
| load | 216 | 132 | -39% |
| idle (12 s) | 82 | 11 | -86% |
| stream (12 s) | 65 | 18 | -73% |
| hidden (12 s) | 50 | ~0 | -100% |
| draft | 335 | 187 | -44% |
| reload | 183 | 93 | -49% |

## 0.18.2 against 0.19.0

The same session with the public 0.18.2 release and 0.19.0, both built with the same
feed folder (median of 3 runs each, plus 3 runs of the fixture alone). Both render the
same five bot rows, avatars and glow on the fixture, with no page errors. Main-thread
ms t3+ adds over the fixture alone:

| phase | fixture alone | 0.18.2 adds | 0.19.0 adds | change |
|---|---|---|---|---|
| load | 66 | 185 | 133 | -28% |
| idle (12 s) | 4.5 | 103 | 14 | -86% |
| stream (12 s) | 169 | 101 | 17 | -83% |
| return | 2.5 | 28 | 6 | -79% |
| navigate | 11.5 | 41 | 9 | -78% |
| draft | 22.5 | 429 | 189 | -56% |
| reload | 14 | 147 | 99 | -33% |

| count | 0.18.2 | 0.19.0 |
|---|---|---|
| style recalcs, idle / stream (12 s each) | 728 / 779 | 8 / 58 |
| style recalcs, draft | 724 | 21 |
| t3+ script ms while hidden (12 s) | 4.5 | 0 |
| storage writes, idle (12 s) | 4 | 0 |

In the hidden phase the page's total main-thread time barely changes (227 and 225 ms
against 154 for the fixture alone): headless Chromium keeps painting the glass and
glow while the stream runs, and that compositing is not t3+ script.

## Proving it is invisible

- The animated PNG's frames, decoded with Pillow, are byte-identical to the sprite
  sheet's frames, with the same delays (200 ms working, 175 ms needs-you).
- In Chromium, 3.5 s of back-to-back captures of each animated avatar give the
  same set of distinct images before and after (8 and 4), changing
  every ~200 ms on both.
- `harness/screenshot.mjs` before and after, same Chromium: all 15
  scenarios are pixel-identical.
- Reduced motion and forced colors keep the old rules (frame 0 of the sheet;
  Highlight). Without an encoder (tests, SVG fallback) the keyframes still run.

## Not changed, and why

- **Glow render cost itself** (~50 ms for the two sprites at load and after a
  resize). Faster math would have to stay bit-exact (`Math.hypot`, `**`); the
  saving is a few tens of ms on rare events. Rendering the wide sprite lazily
  would delay the first new-thread page.
- **backdrop-filter blur** on the glass composer and widgets. It is the look; any
  cheaper blur changes pixels. Not measurable here (software compositing).
- **`t3plus.json` cache write per page load.** One write per load; its `fetchedAt`
  feeds the "cached copy" diagnostic when the server is unreachable.
- **DOM checks while streaming in a visible tab.** Already filtered: text in the
  message list never schedules a check; a 1 s status tick costs ~0.5 ms per check.
