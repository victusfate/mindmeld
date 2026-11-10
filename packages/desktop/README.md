# @mindmeld/desktop: Mind Meld Studio desktop app

An Electron shell that runs the Mind Meld Studio backend (`@mindmeld/server` + `@mindmeld/core`) inside its own
main process and shows the web UI in a locked-down window.

## Why Electron and not Tauri

The initial plan (`docs/mind-meld-studio/initial-plan.md`) proposed a Tauri shell. We use **Electron with a
TypeScript main process** instead (orchestrator decision, 2026-11-10): the repo's default language is TypeScript
(`.agent/default-language.md`), a Rust shell would need owner approval, and Electron runs the existing TypeScript
backend in-process with no sidecar.

## How it works

- On start: single-instance lock, then the login shell's `PATH` is merged into `process.env.PATH`
  (`$SHELL -lc 'printf %s "$PATH"'`, 3 s timeout, macOS/Linux only), so local agent CLIs (claude, codex, agy, pi)
  are found when the app is launched from Finder, the Dock or a desktop launcher.
- The backend starts on `127.0.0.1` with a random port, a fresh random token and its data under
  `<userData>/studio`. The window opens `/auth?token=…`, which swaps the token for an HttpOnly, SameSite=Strict
  cookie and redirects to `/`.
- Renderer: `contextIsolation`, `sandbox`, no Node, no `<webview>`, no preload. In-window navigation is limited to
  the server's origin; `window.open` is always denied (external http(s) links open in the system browser); all
  permission requests are denied.
- The web UI comes from `packages/web/dist` in dev and `resources/web` when packaged. Without it, the server shows
  its placeholder page.
- Quitting closes the HTTP server, then the SQLite store.

Menus: **File**: Open Folder…, Import Bundle…, Export Usage (JSONL)…, Quit. **View**: Reload, DevTools (dev
builds only). **Help**: Status… (sandbox and model availability with reasons), Usage… (the `formatUsage` text,
including the 5h/7d windows and plan limits, with a **Copy** button).

## Build, run, test

The main process is bundled with esbuild (`node build.ts` writes `dist/main.mjs`), because Electron's Node (24.x in
Electron 44) cannot run the workspace's `.ts` sources. `typescript` and `node:sqlite` both work in that build.

```sh
npm install                          # at the repo root; downloads the Electron binary
npm run start -w @mindmeld/desktop   # build + launch
npm test -w @mindmeld/desktop        # unit tests (node:test)
# End-to-end (Playwright's Electron support; needs a display, skips if Playwright is not installed):
MINDMELD_ELECTRON_NO_SANDBOX=1 npm run test:e2e -w @mindmeld/desktop   # the env var only if running as root
npm run package -w @mindmeld/desktop # electron-builder: linux dir/AppImage, mac dmg, win nsis → release/
```

`MINDMELD_ELECTRON_NO_SANDBOX=1` only makes the e2e test pass `--no-sandbox` (Chromium refuses to run as root
with its OS sandbox). The app never turns the sandbox off by itself. Other env vars the app reads:
`MINDMELD_USER_DATA_DIR` (override userData, used by tests) and the backend's own `MINDMELD_*` variables
(`MINDMELD_SANDBOX`, `MINDMELD_MODEL_PROVIDER`, …).
