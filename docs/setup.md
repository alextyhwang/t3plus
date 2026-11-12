# Setting up the feeds and profiles

The glow, glass composer, screenshot mode and bot faces work without any of this. The
usage widgets, the bots' latest messages and the profile tabs need the feeds below.

## Feeds

A browser extension can't read other threads or T3's usage data without T3's private API,
so t3+ reads three small JSON files instead, published from the machine that runs T3:

| File | Made by | Used for |
| --- | --- | --- |
| `t3plus.json` | you (see [`examples/t3plus.example.json`](../examples/t3plus.example.json)) | profile tabs |
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
[`server/config.example.json`](../server/config.example.json) and `server/feedconfig.py`):
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
