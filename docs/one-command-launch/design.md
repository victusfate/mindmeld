# One-command launch: `mindmeld PATH`

Follows [`../retire-desktop-vscode/design.md`](../retire-desktop-vscode/design.md): with the browser as the only
interface, starting Studio on a repo should be one command.

## Decisions
- **D1 — command:** the server bin is `mindmeld` (was `mindmeld-studio`). Positional `PATH…` imports repos;
  `--project` stays as an alias. `npx mindmeld PATH` works in the checkout; `npm link -w @mindmeld/server` puts it
  on PATH. Publishing to npm is out of scope (an owner decision: the workspace packages are private).
- **D2 — reuse:** a PATH whose real path and `--include` scope match an existing local project is refreshed, not
  imported again, so repeated launches do not pile up copies.
- **D3 — port:** without `--port`/`MINDMELD_PORT`, `EADDRINUSE` on 8787 retries on a free port. `launch` closes the
  store when the server fails to start, so the retry does not leak it.
- **D4 — browser:** opened only when stdout is a terminal and `--no-open` is absent (`open` / `cmd start` /
  `explorer.exe` on WSL / `xdg-open`). A failure to open prints a note; the URL is always printed.
- **D5 — landing project:** `/auth?token=…&project=<id>` redirects to `/?project=<id>`; only ids matching
  `prj_<hex>` pass, so the login cannot redirect elsewhere. The web UI selects that project if it exists, else the
  newest. API v1 is unchanged.
- **D6 — errors:** unknown flags print usage and exit 2 (was a stack trace, QA-003 of multi-language-index).
