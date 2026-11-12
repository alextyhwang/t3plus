# Publishing

Develop in the private repository (`origin`). The public repository (`public`) receives
filtered snapshots with its own history. Never push private branches directly to it.

## Automatic releases

After a merge to private `main`, the **Release** workflow:

1. Runs `npm run verify`.
2. Builds a personal ZIP using the private `T3PLUS_FEED_BASE` secret and creates a
   private GitHub release for the version in `package.json`.

**Private pushes never publish to the public repo automatically.** When a version is
ready for the public, open **Actions → Publish public → Run workflow** on private `main`.
That private-only, manually triggered workflow scans and publishes an allowed source
snapshot to public `main`. Its push starts **Release** in the public repository, which verifies the
public source, builds with `--public` (ignoring personal feed settings), and attaches its
ZIP to a public GitHub release with the same version. **Release** never transfers files
between repositories; only **Publish public** can do that.

For a new release, update the version in `package.json`, `package-lock.json` and
`manifest.base.json`, and add its `CHANGELOG.md` section before merging. Existing published
versions are never replaced. Later private merges do not change the mirror; explicitly
publish only the versions intended for public users. A version already released publicly
needs a bump to produce a new public download. Releases start as drafts and become visible
after their ZIP has uploaded. Reruns resume an unfinished draft for the same commit.

The private download is `t3plus-v<version>-personal.zip`; the public one is
`t3plus-v<version>.zip`. Both contain just the built extension. No personal files or feeds
are bundled, although the personal build contains its configured feed URLs. Installing
an update still requires unzipping and reloading the unpacked extension.

## What stays private

`tools/publish-policy.mjs` lists the root files, workflows and source directories allowed
into the mirror. Unknown top-level files and directories stay private by default.

- Put tracked personal notes or other private material under `private/`.
- Machine configuration stays in untracked `t3plus.local.json` and
  `server/config.local.json`. These paths, `.env` files, private key files and nested
  `private/` directories are excluded even inside allowed directories.
- Files intended for the public source directories must be free of personal details.
  Every exported text file, filename and public commit message is checked against
  `PUBLISH_DENY` plus built-in Windows user path and email checks. Findings report only
  locations, without printing matching values or patterns.
- Symlinks and submodules in public paths are rejected.
- A new mirror commit has only public `main` as its parent. Private commits, branches
  and commit subjects never become part of public history.

Changed images and binaries need visual review because text scanning cannot inspect
their content. Publishing stops if any change. After reviewing them, run
**Publish public → Run workflow** on private `main` with **images_checked** enabled.
This retries the mirror without replacing the private release ZIP.

## Repository setup

Configure these in the **private** repository's Actions settings only:

| Setting | Type | Value |
| --- | --- | --- |
| `T3PLUS_FEED_BASE` | Secret | Personal HTTPS feed folder from the local build config |
| `PUBLISH_DENY` | Secret | One case-insensitive regex per line for private names, hosts and paths; at least one required |
| `PUBLIC_PUBLISH_SSH_KEY` | Secret | Private half of a dedicated public-repository write deploy key |
| `PUBLIC_REPOSITORY` | Variable | Public repository in `owner/repo` form |
| `RELEASE_GIT_NAME` | Variable | Maintainer name from the existing Git configuration |
| `RELEASE_GIT_EMAIL` | Variable | Maintainer's GitHub noreply address from that configuration |

Add the deploy key's public half in the **public** repository's deploy keys with write
access. It grants Git access to that repository only. The public push uses this key,
so it triggers the public workflow; a push using `GITHUB_TOKEN` would not. GitHub host
keys are obtained over the authenticated HTTPS API before SSH is used.

Each release uses its own repository's short-lived `GITHUB_TOKEN` with `contents: write`.
The public repo needs no personal secrets or cross-repository credentials. Pull request
checks run without publishing credentials. Keep development and merges in the private repo.

## Local publishing and packaging

The same publishing policy applies locally. Keep the private patterns in untracked
`.publish-deny`, or supply `PUBLISH_DENY` in the environment:

```sh
npm run publish:public                          # scan and show a dry run
npm run publish:public -- --push                 # publish origin/main; Actions releases it
npm run publish:public -- --ref HEAD --push      # publish this exact committed snapshot
```

Use `--images-checked` only after viewing changed images and binaries. `-m` supplies a
custom public commit message, which is also scanned. The legacy `--release` flag is
accepted, but release creation now runs in Actions.

To package without publishing:

```sh
npm run release:package                         # personal ZIP, using local feed config
npm run release:package -- --public              # public ZIP, with no personal feeds
```

Downloads and notes are written to ignored `release/`. A public build leaves `dist/` in
public mode; run `npm run build` to restore the local configured extension afterwards.
