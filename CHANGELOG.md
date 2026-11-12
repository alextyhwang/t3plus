# Changelog

Short history of t3+ releases. Details live in README.md; plans in ROADMAP.md.

## Unreleased
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
