# Setting up feeds and integrations

The glow, glass composer, wallpapers, screenshot mode and bot faces work without any of
this. The usage widgets, bot status, profile tabs and the optional integrations below
need a build that knows where their data lives.

## Configuring a build

Every host and id t3+ uses is in `src/personal.js`; `src/hosts.js` derives each URL
from it. The release ZIP ships it empty, so it fetches nothing. To turn something on,
[build from source](../README.md#building-from-source):

1. Set the values you need in `src/personal.js` (each one is described there):
   `FEED_BASE` for the feeds, and optionally `ASSISTANT_GROUP`, `TASKS_BASE` and
   `IMMICH`.
2. Add each HTTPS origin you set to `host_permissions` in `manifest.json`, for example
   `"https://files.example.com/*"`. `npm test` fails if one is missing.
3. Run `npm run build` and load or reload `dist/`.

Keep your edited `src/personal.js` and `manifest.json` out of any fork you publish if
they name private hosts.

## Feeds

The extension can't read other threads or T3's usage data without T3's private API,
so it reads small JSON files from one folder (`FEED_BASE`) that your browser can reach
over HTTPS. A [Tailscale](https://tailscale.com/kb/1312/serve) file share works well,
because only your own devices can open it:

| File | Written by | Used for |
| --- | --- | --- |
| `t3plus.json` | hand, or an agent in the thread named in its `controlThread` | profile tabs, bot marker |
| `t3plus-bots.json` | `server/publish_bot_feed.py` | each bot's status and next scheduled update; the Assistant's project threads and sub-thread counts |
| `t3plus-home.json` | `server/publish_home.py` | the usage widgets |
| `t3plus-immich.json` | `server/publish_immich_feed.py` | recent-photo asset ids and capture dates, and measured service status, for the Immich widget |

The background worker fetches only the exact URLs in `src/hosts.js`, with no cookies
and no redirects. Feeds are polled only while their surface is on screen.

## Server publishers

`server/publish_all.py` runs the three publishers in one Python process.
`server/install_feed_task.ps1 -Python <pythonw.exe>` registers the "t3plus feeds"
scheduled task that runs it every 2 minutes. The publishers need Python 3.10 or newer,
plus `websockets` for the home feed.

They read T3's database (`statev2.sqlite`) read-only. The home feed also reads T3's API
through a short-lived read-only session from `t3 auth session issue` (5-minute
lifetime, revoked right after the read). No feed contains email addresses, prompts,
message bodies or secrets.

Settings come from the untracked `server/config.local.json` (template:
`server/config.example.json`); each key can also be set by the environment variable
listed in `server/feedconfig.py`. Never commit or print this file: it holds the Immich
API key.

| Key | Meaning |
| --- | --- |
| `t3Home` | T3's data folder (default `~/.t3`) |
| `feedDir` | where the feeds are written (default `<t3Home>/userdata/tailnet-files`) |
| `t3Cli` | the `t3` CLI (default: `t3` on `PATH`) |
| `timeZone` | IANA zone for daily usage (default UTC) |
| `limitsApi` | optional limits-history service that draws the Codex pool's recorded line |
| `activityUrl` | optional tokens-per-day source for the Activity card; without it, Activity counts T3 runs per day |
| `immichUrl` | Immich API origin; the Immich publisher is off until this and `immichApiKey` are set |
| `immichApiKey` | server-only read key, never published |
| `immichStatusUrl` | optional monitor JSON reporting `uptimeSeconds` or a measured `serviceStartedAt`/`hostStartedAt`; without it the card reports reachability, not uptime |

The Immich publisher uses only `GET /api/server/version` and
`POST /api/search/metadata`, emits at most four rows, and never logs the key or copies
original photo data. The extension builds the thumbnail and library links from
`IMMICH` in `src/personal.js`. While the publisher is off, `publish_all.py` skips it;
run on its own, it prints why to stderr and exits 1.

## Profiles (`t3plus.json`)

The extension only reads this file. `harness/t3plus.harness.json` is a working example.

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
      "projects": ["github.com/owner/repo"],
      "threads": ["<environmentId>:<threadId>"],
      "showBots": true
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | 1 to 32 of `a-z 0-9 - _`, unique, not `all` |
| `label`, `color` | tab text (up to 24 characters) and an optional `#rrggbb` dot |
| `projects` | project keys exactly as T3 writes them on folder rows (`data-sidebar-row="folder:<key>"`), usually `github.com/owner/repo`, or a path for folders without a repository |
| `includeAll`, `excludeProjects` | with `includeAll: true`, the profile has every project except those in `excludeProjects` |
| `threads` | thread keys `<environmentId>:<threadId>` (the two parts of a thread's URL), for the flat sidebar and threads outside project folders |
| `showBots` | whether bot rows stay visible in this profile (default `true`) |
| `botMarker` | optional replacement for the bot marker: one `[[...]]` token without spaces. If a restored local marker matches no visible rows, t3+ falls back to its built-in marker for default-marked rows; a custom marker that matches a row stays authoritative |

Limits: 12 profiles, 500 projects and 2000 threads each, 256 KB. Invalid entries are
dropped and listed in Settings; the rest still load. Hidden rows get T3's own `hidden`
attribute, so keyboard navigation skips them. The open thread always stays visible.
The file is re-read on page load, from the Reload button in Settings, and when a T3
tab comes back into view with a copy more than 5 minutes old.

## Assistant group

The router bot (the Assistant) and every other bot sit on top of the thread list with
no header; the Assistant's threads sit under it, one line each. T3's inbox follows
directly, then T3's Working, Snoozed and Settled shelves. The ids are
`ASSISTANT_GROUP` in `src/personal.js`. Design, membership and behavior:
[assistant-group.md](assistant-group.md).

## Tasks

Optional, and only useful with a task service that implements the API below
(`TASKS_BASE`). New-thread drafts of the Assistant project show a task board inside
T3's thread details. Saved conversations have no task widget and never fetch the board. Draft
membership reads only the current route's project/environment/thread identity from
T3's persisted draft state, never a label or the last-used project.

- **API** (on `TASKS_BASE`): `GET api/tasks/board` returns `today`, `upcoming` and
  `waiting` arrays; rows carry category, revision, server-described actions and recent
  agent-thread activity. `api/tasks/session` returns the CSRF token. The worker sends
  credentials only to these task routes.
- **Actions:** complete, change category and run the offered agent actions. Writes need
  the session's CSRF token and the row's current revision; a stale revision refreshes
  the list without replaying the edit, and results arriving after a draft or context
  change are ignored. New tasks are created on the task site's own page.
- **Session:** the service mirrors its HTML login into an API-scoped cookie and allows
  the extension's fixed origin. On 401 the widget offers **Sign in with passkey**, which
  opens the task site's sign-in in a small window; returning to T3 retries at once.
- **Lifetime:** refreshes once a minute while visible; Refresh retries immediately.
  Closing details discards the payload. Tasks never reach extension storage, Chrome
  Sync, page storage or backups.
- **Layout:** the list scrolls within details and ends level with the lowest home
  widget (75% of the viewport without a home grid). Widgets and details follow the
  composer's visible paint layer; see `src/glassMaterial.js`.

## Calendar

Shown above Tasks in the same drafts, read from the task service's agenda route:
[calendar.md](calendar.md).

## Immich

New-thread drafts of the Immich project (`IMMICH.projectId` / `environmentId`) show
up to `maxPhotos` recent photos and the service status from `t3plus-immich.json`.
Thumbnails load from `imageEndpoint`, the proxy that adds the API key server-side;
the key never reaches the extension. `libraryUrl` opens the normal library.
