# t3+ roadmap

## Done

**v0.1**: extension foundation + composer gradient (image / bottom half-circle).

**v0.2** (this version):

- [x] Profile strip in the sidebar (All + profiles), project-level filtering with a
      thread-level fallback for the flat sidebar, last-thread restore per profile,
      deep links kept visible. Active profile and last threads in `chrome.storage.local`.
- [x] Server-owned profile definitions: read-only `t3plus.json` (control-thread
      design), fetched by a background worker from one exact URL; cached copy, local
      override and visible diagnostics when it is unreachable. No private RPC.
- [x] Bot rows: exact `[[t3plus:bot:v1]]` title marker, decorated in place on T3's row
      (small icon with status dot, thin accent edge and wash, muted BOT tag with
      model/computer labels and child count). No shelf, rail or cloned rows.
      Per-bot presentation (incl. local icon upload) in Settings, keyed by
      `environmentId:threadId`. Read-only: no rename, pin or reorder.
- [x] Minimal-overlay correction: removed the bot shortcut row; the profile strip is
      one compact row; the harness is a T3-shaped fixture (card rows, T3 tokens) so
      screenshots show T3 with the overlay, not a different app.
- [x] Background + glass: the gradient/image moved behind the conversation as a
      static layer; the composer card is translucent glass with blur, opaque
      fallbacks, forced-colors and reduced-transparency handling.

**v0.3**:

- [x] Background glow no longer jumps sideways on thread switches (the theme stopped
      resetting the measured composer anchor; mid-mount composers are ignored).
- [x] Bots: shape + color only (fixed dithered gradient per color), 32 px avatar,
      T3's normal row height, name + time on line 1 and the latest message below,
      fed by the server-published `t3plus-bots.json`.

**v0.4**:

- [x] Real ordered dither for the background (canvas, 16x16 Bayer, crisp device-pixel
      cells) instead of a soft-light texture; Pixel dither toggle.
- [x] Bot faces: 24x24 dithered body with pixel eyes placed per shape.

**v0.5**:

- [x] Bot rows: one-line preview, model · computer line, identical height for every bot.
- [x] Bot moods: closed eyes idle, animated working / needs-you sprites, happy, X, lidded.
- [x] Dither pixel size fixed in CSS px (was too fine on Retina); Pixel size option.
- [x] Glow anchors on T3's composer even though its overlay is a sibling of the pane.

**v0.6**:

- [x] Background dither rethought as 1-bit dots (density only) with a dot-gap grid and a
      hot-core color ramp; glow stretched wider and lowered slightly; Medium dots default.

**v0.7**:

- [x] Bot rows: name + one-line message only (model/computer line removed), one height.
- [x] Three background dither styles: Dots, Pixel, Halftone.

**v0.8**:

- [x] Dither styles are three pixel variants (Bayer, Grain, Spectrum); compact glow.
- [x] Realistic Settings preview (mini T3 with real bots and the real dither).
- [x] Bot names follow T3's title state classes (gray until open, hover).

**v0.9** (phase 2 begins):

- [x] Home widgets on the new-thread page: activity, recent threads, Claude limits,
      Codex pool, this month, up next. Data from T3's own read-only API and DB.
- [x] Dither glow shows on the new-thread page, centered on the composer.

**v0.10**:

- [x] Home widgets compacted to a 2x2 grid at composer width: Codex pool and Claude pool
      (pool chart with a projection), Activity (14 weeks + quick
      numbers), Usage (T3's usage chart). Recent threads, Up next and the Claude
      limit bars removed (the sidebar already has them).

**v0.11**:

- [x] Activity = AI tokens per day from an external source, filling its card, with day/month labels.
- [x] Claude pool weighted by plan (Max $100 = 5x Pro): 600%.
- [x] Bot rows: one status signal (face + T3's label); status dot and T3's status icon removed.

**v0.12**:

- [x] Hover tooltips (T3 style and motion) on the heatmap and all charts, with a crosshair.
- [x] Glow sprite moved by animated CSS lengths: smooth slide between new thread and thread;
      centered on the new-thread page; spread 10% smaller.
- [x] Defaults: glass strength 85, intensity 45.
- [x] Football and Basketball bot avatars.

**v0.13**:

- [x] Football on the diagonal (fatter); idle faces keep their eyes open.
- [x] Bot hover card: face + clean name instead of the raw marker title.
- [x] Glow slide 150 ms with an unthrottled check right after navigation; new-thread glow
      back around the composer.
- [x] Compact sidebar header: logo row hidden, T3's sidebar button before the breadcrumbs.
- [x] Settings: no false "composer without hooks" warning (T3's font preview editor).

**v0.14**:

- [x] Settings persist: fixed extension ID, Chrome Sync mirror, Export / Import.
- [x] Sidebar top row aligned with the header.

**v0.15**:

- [x] Own **t3+** entry in Settings; consolidated panel with an Advanced section.
- [x] Title first rows; Chat width and Chat text size.
- [x] Extension icon (pixel plus) and a toolbar button that opens Settings → t3+.
- [x] New-thread hero centered; wider hero glow that shrinks smoothly into a thread.
- [x] Performance pass (watcher noise filter, scoped popup observers, cached colors, PNG
      bot faces, on-screen-only feed polling, one-process publisher).

**v0.16**:

- [x] Thread details: the current provider's pool replaces T3's usage limits rows; hidden
      on the new-thread page; details card material matches the widgets.
- [x] New-thread glow spread 1.15x.

**v0.17**:

- [x] Screenshot mode: stand-in titles, projects, badges, branches, machines, profiles, bots
      and message text; restorable, read-only.
- [x] Title-first fixes (environment/worktree lines, hover), icon-only Settle.
- [x] Settings copy in T3's page storage; hero a little higher; chat width/size removed.

**v0.18**:

- [x] Public-ready repo: README with screenshots, feed folder set at build time,
      portable feed publishers, neutral fixtures.

## v2 candidates (not built)

Each needs its own design pass, especially anything that would read T3 server state.

- **Pull requests widget.** T3 has no linked PRs yet (0 rows); add it when it does.
- **Profile editing from the extension.** Today profiles change only through the
  control thread / `t3plus.json`. Writing back would need a public, authenticated path.
- **Profile matching by project name** for pinned cards outside folders (today: explicit
  `threads`).
- **Bot extras.** Unread badges, only if they fit inside T3's existing row.
- **From the upstream PR scan (small CSS, not built yet).** Menu/select/dialog fade-in
  (#26708, #28699); hide the thread minimap (#32900); fade messages behind the glass
  composer footer (#30064, #32683); visible dark scrollbar thumb (#30031); pinned-row
  tint (#31622). If T3's redesign stack (#28839 to #28845) merges: fallbacks for the glass
  variables, `aria-label="T3 Code home"`, the breadcrumb label and the hero's
  `items-center`.
- **Polish.** A popup with an on/off switch. Per-theme (light/dark)
  background settings. Image position (top, center, bottom).

## Ground rules to keep

- Host list stays explicit (`src/hosts.js`), never `<all_urls>`. Network reads are
  exact URLs listed there.
- T3 selectors stay in `src/config.js` (and `content.css`), documented with their
  source file in T3.
- Read-only toward T3: no private RPC, no renames/pins/moves of React-owned rows.
- No continuously repainting effects. Effects never intercept pointer events.
- Minimal overlay: decorate T3's own elements in place; the sidebar gets at most the one
  profile strip. Screenshots come from the T3-shaped harness and must still read as T3.
