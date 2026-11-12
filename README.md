# t3+

t3+ is a Chrome extension that adds a few things to the [T3 Code](https://t3.codes) web
app: a pixel-art glow behind a glass composer, usage widgets on the new-thread page, bot
threads that look like chat contacts, profile tabs for the sidebar, and a screenshot mode
that swaps your thread and project names for made-up ones.

It works by styling the page T3 already renders. There is no fork of T3 and no server
change, and the extension never writes anything to T3.

![t3+ on T3 Code's new-thread page: the dithered glow, glass composer and the four usage widgets](docs/images/home.png)

<sub>The new-thread page with t3+. Screenshot mode is on, so the thread, project, bot and
profile names are stand-ins.</sub>

t3+ is an unofficial, personal project. It is not made by or affiliated with the T3
Code team, and T3 Code changes often, so some part of it can break after a T3 update.

## What it adds

### A glow behind a glass composer

A dithered pixel-art glow sits behind the composer, and the composer becomes see-through
glass on top of it. There are three pixel looks (Bayer, Grain and Spectrum) plus a smooth
gradient, or you can use an image. The color follows your T3 theme unless you pick an
accent. On the new-thread page the glow surrounds the composer, and when you open a
thread it shrinks smoothly to the bottom of the pane.

![The glass composer over the Bayer, Grain and Spectrum glow](docs/images/composer-looks.png)

The glow is drawn once into a small canvas and shown as a crisp, pixelated image. It is
re-rendered only when the pane size, composer position, colors or settings change, and
nothing animates continuously.

### Usage widgets on the new-thread page

Under the composer, four small cards:

| Card | Shows |
| --- | --- |
| Codex pool | What is left of your Codex weekly limits, summed across accounts, with the last 3 days, a dashed projection for the next 3, the next reset, and a warning when the projection runs out before then |
| Claude pool | The same for your Claude accounts (a Max plan counts as 5x Pro) |
| Activity | Tokens per day as a heatmap, 20 weeks |
| Usage | T3's own usage chart: tokens per day by provider, plus this month's spend |

Every card has hover tooltips in T3's style. When T3's thread details panel shows usage
limits, t3+ swaps in the pool card for the provider you're using in that thread.

The charts are drawn as dithered pixels on the same grid as the glow: each area is solid
just under its line and fades out toward the bottom. T3's own Usage page chart gets the
same fill; t3+ paints it underneath T3's chart and keeps T3's gridlines, hover line and
tooltip.

These cards need the home feed, a JSON file that a small script builds from T3's own
read-only API (see [Feeds](#feeds)).

### Bots

Put the marker `[[t3plus:bot:v1]]` at the start or end of a thread's title, for example
`[[t3plus:bot:v1]] Release Captain`, and t3+ shows that thread like a chat contact: a
pixel-art face, the name, and its latest message underneath. The face follows the
thread's status. It looks around while the thread is working, opens its eyes wide when
the thread needs you, smiles when it's done and shows X eyes when it fails. Each bot gets
a shape (circle, square, triangle, diamond, hexagon, star, football or basketball) and a
color, set in Settings.

t3+ never renames, pins or moves the thread. Pin it in T3 to keep it at the top. The
latest-message line comes from the bot feed (see [Feeds](#feeds)). Without the feed,
that line stays empty.

### Profile tabs

A small segmented control under T3's search box (All, plus your profiles) hides the
sidebar rows that aren't in the selected profile, and switching tabs reopens that
profile's last thread. Profiles are defined in a `t3plus.json` file (see
[Profiles](#profiles)). You can also paste one into Settings as a local override.

### Screenshot mode

Turn it on in Settings → t3+, or press Alt+Shift+D anywhere in T3. Thread titles become
plausible agent tasks, project names become product-style repo names (and their letter
badges change to match), and branches, machine names, profiles, bots and the text of every
message are replaced with stand-ins of about the same length. Widgets, icons, times and
counts stay real, so the UI still looks like yours.

![A thread in screenshot mode, with the provider's pool in the thread details panel](docs/images/thread.png)

Only the text you see changes. Each piece of text remembers its real value, and turning
the mode off puts every one back. T3's data, the composer and the hidden titles screen
readers use are never touched. Each real name always maps to the same stand-in, and no two
real names share one, so screenshots stay consistent across pages and reloads.

### Smaller things

- Title first (off by default) puts the title on top of each thread row, with
  `project · branch` underneath.
- Compact sidebar header (on by default) hides the T3 logo row, so search, the sidebar
  button and the breadcrumbs share one line.
- Everything is configured from a t3+ entry in T3's Settings sidebar, right after
  Appearance, with a live preview. The toolbar icon opens it.

## Install

You need Node 20 or newer and Chrome (or another Chromium browser).

```sh
git clone https://github.com/alextyhwang/t3plus.git
cd t3plus
npm install
npm run build        # writes dist/
```

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick the `dist/` folder.
3. Open or reload https://app.t3.codes, then click the t3+ toolbar icon (or go to
   Settings → t3+).

The glow, glass composer, screenshot mode, title-first rows, compact header and bot faces
work right away. Usage widgets, bot messages and profile tabs need the feeds below.

To update, pull, run `npm run build`, click the reload icon on the t3+ card in
`chrome://extensions`, and reload the T3 tab.

## Feeds

A browser extension can't read other threads or T3's usage data without T3's private API,
so t3+ reads three small JSON files instead, published from the machine that runs T3:

| File | Made by | Used for |
| --- | --- | --- |
| `t3plus.json` | you (see [`examples/t3plus.example.json`](examples/t3plus.example.json)) | profile tabs |
| `t3plus-bots.json` | `server/publish_bot_feed.py` | each bot's latest message |
| `t3plus-home.json` | `server/publish_home.py` | the usage widgets |

Put them in one folder that your browser can reach over HTTPS. A
[Tailscale](https://tailscale.com/kb/1312/serve) file share works well, because only your
own devices can open it. Then tell the build where that folder is, either with an
environment variable:

```sh
T3PLUS_FEED_BASE=https://my-machine.my-tailnet.ts.net/files/ npm run build
```

or with an untracked `t3plus.local.json` in the repo root:

```json
{ "feedBase": "https://my-machine.my-tailnet.ts.net/files/" }
```

The build turns that folder into exactly three host permissions, one per file. The
background worker fetches only those URLs, sends no cookies and follows no redirects. If
you build without a feed folder, t3+ fetches nothing.

### Publishing the feeds

The two scripts in `server/` need Python 3.10 or newer, plus the `websockets` package for
the home feed. They read T3's database (`statev2.sqlite`) read-only. The home feed also
reads T3's API through a short-lived read-only session from the official
`t3 auth session issue` CLI (5-minute lifetime, revoked right after the read). They never
publish email addresses, prompts or secrets.

```sh
cd server
python publish_bot_feed.py
python publish_home.py
```

Settings come from environment variables or an untracked `server/config.local.json` (see
[`server/config.example.json`](server/config.example.json) and `server/feedconfig.py`):
T3's data folder (default `~/.t3`), the output folder, the `t3` CLI and your time zone.
Two sources are optional. `limitsApi` points to a service that records Codex usage over
time and draws the Codex pool's recorded line. `activityUrl` points to a JSON source of
tokens per day for the Activity card. Without them, the Codex card shows the current value
and projection, and Activity counts T3 runs per day.

On Windows, `server/install_feed_task.ps1 -Python <path to pythonw.exe>` registers a
scheduled task that runs both scripts every 2 minutes.

## Profiles

`t3plus.json` is read-only to the extension. You edit it yourself, or ask an agent in a
T3 thread to edit it for you (put that thread's key in `controlThread` so the file
records who maintains it).

```json
{
  "version": 1,
  "updatedAt": "2026-11-11T22:30:00Z",
  "controlThread": "<environmentId>:<threadId>",
  "botMarker": "[[t3plus:bot:v1]]",
  "profiles": [
    {
      "id": "work",
      "label": "Work",
      "color": "#60a5fa",
      "includeAll": false,
      "excludeProjects": [],
      "projects": ["github.com/acme/api", "github.com/acme/web"],
      "threads": ["<environmentId>:<threadId>"],
      "showBots": true
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | 1 to 32 of `a-z 0-9 - _`, unique, not `all` |
| `label`, `color` | Tab text (up to 24 characters) and an optional `#rrggbb` dot |
| `projects` | Project keys exactly as T3 writes them on folder rows (`data-sidebar-row="folder:<key>"`), usually `github.com/owner/repo`, or a path for folders without a repository. To find one, inspect a folder header in DevTools |
| `includeAll`, `excludeProjects` | With `includeAll: true`, the profile has every project except those in `excludeProjects` |
| `threads` | Thread keys `<environmentId>:<threadId>` (the two parts of a thread's URL), for the flat sidebar and threads outside project folders |
| `showBots` | Whether bot rows stay visible in this profile (default `true`) |
| `botMarker` | Optional replacement for the bot marker: one `[[...]]` token without spaces |

Limits: 12 profiles, 500 projects and 2000 threads each, 256 KB. Invalid entries are
dropped and listed in Settings; the rest still load. Hidden rows get T3's own `hidden`
attribute, so keyboard navigation skips them. The open thread always stays visible, even
outside the profile, so links keep working. The file is re-read on page load, from the
Reload button in Settings, and when a T3 tab comes back into view with a copy more than
5 minutes old.

## Privacy and permissions

- The content script runs only on `https://app.t3.codes/*` (the list is in
  `src/hosts.js`; add a self-hosted T3 origin there if you need one).
- Permissions: `storage`, plus the three feed URLs if you configured them.
- t3+ does not call T3's WebSocket API, read cookies or credentials, or send anything to
  T3's server. It doesn't rename, pin or move threads.
- Settings, bot shapes and colors, and uploaded background images stay in
  `chrome.storage.local`. Uploads are never sent anywhere.

Settings also survive reinstalling the extension. The manifest has a fixed `key`, so every
build gets the same extension ID wherever you unpack it. Settings are mirrored to
`chrome.storage.sync` (when Chrome Sync is on) and to T3's own page storage (key
`t3plus.backup.v1`), and are restored from either on a fresh install. Settings → t3+ →
Advanced → Backup exports and imports everything, including an uploaded image.

## How it works

T3 is a React app, so t3+ never moves or re-creates its elements. It adds attributes and
CSS, and inserts only its own few elements (the profile strip, the widgets, the settings
panel), each marked `data-t3plus-owned`. One `MutationObserver` re-applies everything at
most every 200 ms, and every write is idempotent, so a pass that changes nothing doesn't
trigger another. Streaming message text is ignored by the observer. Bot faces are drawn
once per shape, color and mood, and cached as small PNG sprites.

Every T3 hook t3+ depends on (selectors and data attributes) lives in `src/config.js`, with
a few repeated in `src/styles/content.css`. When T3 changes its markup, that's where to
look first.

## Development

```sh
npm test             # node:test + jsdom
npm run verify       # build + test
npm run harness      # a T3-shaped test page at http://127.0.0.1:4378/env1/a1
CHROME=/path/to/chrome npm run screenshots   # renders harness scenarios to harness/out/
```

The harness in `harness/` is a test fixture shaped like T3 (its layout, row markup and
dark theme), with a stub for the `chrome.*` APIs and no real T3 session. Query parameters
seed its state: `?seed=` settings, `?config=` a `t3plus.json`, `?view=` the profile view,
`?bots=` bot settings, `?light` for the light theme.

```
src/hosts.js            pages and feed URLs (the build copies them into the manifest)
src/config.js           T3 selectors, defaults, limits, storage keys
src/app.js              wiring (dependency-injected for tests)
src/content/index.js    content-script entry
src/background.js       service worker: fetches the feeds, opens Settings
src/settings.js         settings normalization and storage
src/backup.js           Chrome Sync and page-storage copies of the settings
src/settingsSection.js  the t3+ entry in T3's Settings sidebar
src/appearancePanel.js  the settings panel
src/backdropRenderer.js the dithered glow (canvas)
src/ditherMath.js       Bayer matrix, glow and image dithering
src/composer.js         glass composer hooks
src/homeData.js         home feed parsing and the pool math
src/homeWidgets.js      the widgets
src/ditherChart.js      the dithered chart fills
src/usageDither.js      the same fills under T3's Usage page chart
src/homeTooltip.js      the widget tooltips
src/sidebar.js          sidebar scan and profile visibility
src/profileBar.js       the profile strip
src/profiles.js         routes and last thread per profile
src/remoteConfig.js     t3plus.json validation and loading
src/bots.js             bot marker, status and row decoration
src/botArt.js           pixel-art bot faces
src/botFeed.js          bot feed parsing
src/demoMode.js         screenshot mode
src/demoText.js         screenshot mode's stand-in names and text
src/domWatcher.js       the throttled MutationObserver
src/styles/content.css  all styles
server/                 the feed publishers
harness/                the T3-shaped test page and screenshot script
```

## Known limitations

- Web only. T3's desktop and mobile apps are not affected.
- T3 Code changes often. A T3 update can break a hook until `src/config.js` is updated.
- Image backgrounds on a light theme look grey with the dark sample image; use a lighter
  image or lower intensity.
- Bot status comes from T3's visible status label, and the latest-message line can be a
  couple of minutes old.
- Screenshot mode doesn't change the browser tab's title, favicons or the composer's
  draft.

## License

t3+ is released under the [PolyForm Noncommercial License 1.0.0](LICENSE). You can use,
fork and change it for any noncommercial purpose, including personal projects, study,
research, and use by charities, schools and public institutions. If you share it or a
fork of it, keep the `Required Notice` line from [LICENSE](LICENSE) so the original is
credited. Commercial use, including use by a company for its business, is not allowed.

Changes are in [CHANGELOG.md](CHANGELOG.md) and plans in [ROADMAP.md](ROADMAP.md).
