# Working on t3+

- Run `npm run verify` before committing.
- T3 selectors live in `src/config.js`. When T3 changes its markup, start there.
- Every endpoint and integration comes from `src/personal.js`; `src/hosts.js` derives
  each URL from it. The shipped file configures nothing, so a fresh build fetches
  nothing. Tests run against `test/support/personal.js` (example hosts), loaded in
  its place by `test/support/register.mjs`.
- `manifest.json` must grant the origin of every endpoint `src/personal.js` sets
  (checked by `test/manifest.test.js`), and nothing broader: never `<all_urls>`.
- Keep personal details out of tracked files: real names, hosts, ids, local paths and
  e-mail addresses. `server/config.local.json` is untracked and may hold an API key;
  keep it out of commits, logs and output.
- Read-only toward T3: no private RPC, no writes to T3, no DOM moves of React-owned
  rows. Feature notes are in `docs/`.

## Releasing

1. Bump the version in `package.json`, `package-lock.json` and `manifest.json`, and add
   a `## X.Y.Z (date)` section to `CHANGELOG.md`; the release notes come from it.
2. Run `npm run verify`, then `npm run release:package` to build
   `release/t3plus-vX.Y.Z.zip`, and `npm run release:check` to load that ZIP in
   Chromium against the harness fixture.

Pushing to `main` runs the Release workflow, which builds the same ZIP and attaches it
to a GitHub Release for the version. A published version is never replaced; a new
download needs a version bump.
