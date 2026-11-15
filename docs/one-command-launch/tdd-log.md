# TDD log: one-command launch

- Tests were written alongside the code in one pass (not strictly RED first): `packages/server/test/cli.test.ts`
  (parse, open command, lookup, unknown flag exit 2, end-to-end import → reuse → port fallback → redirect) and the
  `/auth` redirect assertions in `server.test.ts`. On main the CLI test fails (no `cli-args.ts`, no reuse, no
  fallback) and the redirect assertion fails (always `/`).
- Live check: three launches on one data dir (combat-game, client, combat-game). The third prints
  `refreshed combat-game`; Chromium on its login URL lands on `/?project=…` with combat-game selected although
  client is newer; no console errors.
- Not exercised live: the real browser open (it would open a tab on the owner's machine); covered by `openCommand`
  unit tests.
