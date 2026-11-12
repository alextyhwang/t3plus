# Publishing

t3+ is developed in a private repository and mirrored to the public one.

| Remote | Repository | Used for |
| --- | --- | --- |
| `origin` | the private repo | all work: branches, pull requests, full history |
| `public` | `alextyhwang/t3plus` | releases; a short history of published snapshots |

Work happens on `origin` as usual. Nothing reaches the public repo until you run:

```sh
npm run publish:public                       # dry run: changed files and checks
npm run publish:public -- --push             # one new commit on public/main
npm run publish:public -- --push --release   # ...plus a GitHub release for package.json's version
```

The script copies the files of `origin/main` (or `--ref <commit>`) onto `public/main` as a
single commit whose message lists the private commit subjects since the last publish (or
pass `-m`). Private history, branches and pull requests never leave `origin`.

Before it pushes, it checks every text file and the commit message against the
untracked `.publish-deny` file (one case-insensitive regex per line for names, hosts and
paths that must stay private) plus built-in checks for Windows user paths, e-mail
addresses and committed local config files. It can't read images, so when one changes it
stops until you have looked at it and rerun with `--images-checked`.

`--release` builds with `node build.mjs --public` (no feed folder, whatever
`t3plus.local.json` says), zips `dist/` as `t3plus-v<version>.zip`, takes the notes from
that version's CHANGELOG section, and creates the release on the public repo. It skips a
version that is already released, so bump `package.json` and `manifest.base.json` first.
Afterwards it rebuilds `dist/` with your own feed folder.

Never push `origin` branches to `public` directly: they carry the private history.
