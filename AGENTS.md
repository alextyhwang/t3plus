# Working on t3+

- `origin` is the private repository. Commit, branch, push and open pull requests there.
- `public` is the public mirror. Never push to it with git directly. Publish with
  `npm run publish:public` (see [docs/publishing.md](docs/publishing.md)), and only when
  the owner asks.
- Keep personal details out of tracked files: real names, project names, machine names,
  hosts, local paths and e-mail addresses. Machine-specific settings go in the untracked
  `t3plus.local.json` and `server/config.local.json`.
- Run `npm run verify` before committing. T3 selectors live in `src/config.js`.
