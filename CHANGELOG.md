# Changelog

Short history of t3+ releases. Details live in README.md; plans in ROADMAP.md.

## Unreleased

## 0.19.1 (2026-11-27)

- Home widgets are back on the new-thread page. T3's November 26 update
  (pingdotgg/t3code da36859c) changed how it centers the new-thread composer,
  and t3+ no longer recognized the page. t3+ now recognizes both the new and
  the old layout.

## 0.19.0 (2026-11-17)

**Faster.** Much less work in your T3 tab. Measured with the new
`npm run perf` session against 0.18.2, both built with the same feed folder
(main-thread time t3+ adds to the page, medians of 3 runs):

| phase | 0.18.2 | 0.19.0 | change |
|---|---|---|---|
| page load | 185 ms | 133 ms | -28% |
| 12 s idle | 103 ms | 14 ms | -86% |
| 12 s of a reply streaming | 101 ms | 17 ms | -83% |
| 4 route changes | 41 ms | 9 ms | -78% |
| new-thread page (widgets) | 429 ms | 189 ms | -56% |
| reload | 147 ms | 99 ms | -33% |

Style recalculations in 12 idle seconds fell from 728 to 8, and t3+ runs no script at
all in a hidden tab (4.5 ms per 12 s before).

- Working and needs-you bot faces play as animated PNGs, which Chrome runs off the
  main thread. The old keyframe animation recalculated style 60 times a second for as
  long as a bot was busy.
- The glow renders once per page load instead of twice, and its sprite is drawn on
  the CPU.
- Hidden tabs run no DOM checks; one check runs when the tab shows again.
- Unchanged feed polls no longer rewrite their caches, and Chrome Sync and the
  page-storage copy are written only when a value changed.
- The Settings panel is drawn only while it is on screen, bot faces share one canvas,
  and the pixel charts repaint only when their pixel size changes.

**Rewritten setup.** The source was restructured with no visible change, around one
setup file:

- `src/personal.js` holds every host and id, and `src/hosts.js` derives each URL from
  it. It ships empty, so the release ZIP fetches nothing, as before.
- **If you build with feeds:** `T3PLUS_FEED_BASE` and `t3plus.local.json` are no longer
  read. Set `FEED_BASE` in `src/personal.js` and add its origin to `host_permissions`
  in `manifest.json` (which replaces `manifest.base.json`). See docs/setup.md.
- Stopping t3+ (an extension reload) can no longer be undone by a late feed response,
  and storage read/write failures are logged instead of swallowed.
- The home feed no longer publishes fields nothing reads, and the bot feed no longer
  publishes message bodies.

**New.**

- Bot rows show what the bot is doing instead of its latest message: approvals and
  questions first, then running work, open threads or All caught up. Scheduled bots
  show their next update in your local time.
- Sidebar statuses show T3's icon and time without the word (Working, Done,
  Approval, Input), on bot rows too. Under Title first, a pinned row's pin sits next to
  its project icon.
- Bundled Aurora, Contours and Facets wallpapers in Appearance.
- Widgets and the details card match the composer's real material, including custom
  themes and transparency preferences.
- A floating browser preview below thread details, with Expand into the upper chat
  column (docs/floating-preview.md).
- Optional, when configured in `src/personal.js`: an Assistant group that puts your
  bots on top with one router bot's threads under it (docs/assistant-group.md), and
  Tasks, Calendar and Immich photos in new-thread details.
- Bot rows are found even while T3 briefly drops a row's hidden title copy, and a
  restored custom bot marker that matches no rows falls back to the built-in one.

**Development.** `npm run perf` measures what t3+ costs a T3 tab over a scripted
session (docs/notes/PERFORMANCE.md), and `npm run release:check` loads the release ZIP
in Chromium against the harness fixture. The mirror-publishing tooling is gone.

## 0.18.2 (2026-11-12)
- Compact sidebar: fix an empty sidebar after the latest nightly. When T3 wraps the
  header, search and thread list in one block, t3+ hid the whole block because it
  holds the logo. t3+ now hides only the logo row itself and keeps the profile strip
  right above the thread list.

## 0.18.1 (2026-11-12)
- GitHub Actions builds versioned downloads in both repositories. Private releases
  include the configured feeds. Public publishing is an explicit workflow choice;
  it triggers a public release built without personal feeds.
- Publishing exports only allowed source paths and scans for private details.
  Private files and commit history stay in the private repository.
- Compact sidebar: keep the T3 Code logo hidden and search controls aligned when
  the profile strip precedes the logo after a nightly update.
- The repo is developed privately and mirrored here with `npm run publish:public`, which
  checks for private details and can cut a release (docs/publishing.md).
- `node build.mjs --public` builds without a feed folder (used for release zips).

## 0.18.0 (2026-11-12)
- Ready to publish: a short README with screenshots (docs/images), setup details in
  docs/setup.md, and no personal setup in
  the repo.
- The feed folder is set at build time (`T3PLUS_FEED_BASE` or an untracked
  `t3plus.local.json`). Built without one, t3+ fetches nothing.
- Feed publishers read their folders, the `t3` CLI, the time zone and the two optional
  sources (a Codex limits-history service and a tokens-per-day activity source) from
  environment variables or an untracked `server/config.local.json`
  (`server/feedconfig.py`). The task installer takes `-Python`.
- Example profiles, tests and harness fixtures use neutral names.
- License: PolyForm Noncommercial 1.0.0 (forks allowed with credit; no commercial use).

## 0.17.0 (2026-11-12)
- **Screenshot mode** (Settings → t3+, or Alt+Shift+D): believable stand-ins for thread
  titles, project names (with matching letter badges), branches, machine names, profile
  and bot names, and message text, so the UI can be shared without personal details.
  Widgets stay real. A read-only cover: only visible text nodes change, each restored
  when the mode is turned off; T3's data, the composer and hidden titles are untouched.
- Title first: rows with an environment or worktree line no longer overlap or squeeze
  the title, and the second line stays put on hover. Settle is just its check mark.
- Settings now also keep a copy in T3's page storage, restored when the extension is
  removed and loaded again (even with Chrome Sync off).
- New-thread hero sits a little higher again (35% of the spare height above it).
- Removed Chat width and Chat text size.

## 0.16.0 (2026-11-12)
- Thread details: with T3's **Usage limits** shown, its rows are replaced by the pool chart
  of the provider in the composer (Codex pool or Claude pool, the home widget card). On
  the new-thread page usage limits are left out of thread details (the widgets show them).
- Thread details card uses the same material as the widget cards and glass composer.
- New-thread glow spread reduced to 1.15x (the thread glow is unchanged).
- "Home widgets" setting is now **Usage widgets** (same stored value) and covers both.

## 0.15.0 (2026-11-12)
- t3+ has its own **t3+** entry in T3's Settings sidebar (after Appearance), and the
  toolbar icon opens it. The panel is consolidated: Look (background, style, look,
  intensity, glass), Features, Bots, and a collapsed **Advanced** (accent, pixel size,
  glass on/off, profile source, backup, reset). Storage keys and the settings schema are
  unchanged, so 0.14 settings carry over; "Pixel dither" off now reads as Look = Smooth.
- **Title first** (default off): thread rows show the title on top, then project · branch.
- **Chat width** and **Chat text size** (from the upstream PR scan: #27575, #33633).
- Extension icon: a pixel-art plus with a dithered glow (SVG source + PNGs).
- New-thread page: the headline, composer and widgets are centered (slightly low) in the
  pane, and the glow spreads a little wider there (1.15x); it shrinks smoothly into the thread glow
  (a crossfade of two crisp sprites, composited transform + opacity).
- Performance: streaming chat text no longer schedules DOM checks; the hover-card
  observer watches only `<body>`'s children and portals; theme colors are cached; bot
  faces are ~1 KB PNGs instead of up to ~40 KB SVGs; the home feed is fetched only while
  the widgets are on screen and the bot feed only while bots exist. Server: one Python
  process for both publishers (no PowerShell wrapper), and the external activity source is
  cached for 30 minutes.
- Hover-card title selector also accepts `font-semibold` (T3's open redesign PRs).

## 0.14.0 (2026-11-12)
- Settings survive updates and reinstalls: fixed extension ID (manifest key), Chrome Sync
  mirror with restore on a fresh install, and Export / Import in Settings → Backup.
- The sidebar's top row (search and its icons) lines up with T3's sidebar button and the
  breadcrumbs.

## 0.13.0 (2026-11-12)
- Football avatar on the diagonal and fatter; idle faces keep their eyes open.
- Bot hover card shows the bot's face and clean name (no `[[t3plus:bot:v1]]`).
- Glow slides in 150 ms; the DOM watcher runs unthrottled for 600 ms after a navigation.
- New-thread glow sits around the composer again.
- Compact sidebar header (default on): T3 logo row hidden, sidebar button before the breadcrumbs.

## 0.12.1
- No false "composer editor without hooks" warning on Settings (T3's font preview).

## 0.12.0
- Hover tooltips (T3 style and motion) on the heatmap and all charts, with a crosshair.
- Glow drawn once as a sprite and moved with animated CSS lengths.
- Defaults: glass strength 85, intensity 45; glow spread 10% smaller.
- Football and Basketball avatars.

## 0.11.0
- Activity = AI tokens per day from an external activity source; Claude pool weighted by plan (Max = 5x Pro).
- Bot rows show one status signal (face + T3's label).

## 0.10.0
- Home widgets compacted: Codex pool, Claude pool, Activity, Usage.

## 0.9.0
- Home widgets on the new-thread page; dither shows on that page.

## 0.8.0 and earlier
- Pixel dither styles (Bayer, Grain, Spectrum), realistic Settings preview, bot names
  that follow T3's title styling, bot moods and faces, profiles, glass composer.
