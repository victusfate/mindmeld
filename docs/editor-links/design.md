# Editor links: open a source span in the user's editor

Replaces the VS Code extension's "open at symbol" (see [`../retire-desktop-vscode/design.md`](../retire-desktop-vscode/design.md)).

## Decisions
- **D1 — where:** the source panel shows **Open in <editor>** beside the span. It opens
  `<scheme>://file/<abs path>:<line>`, which VS Code, VS Code Insiders, Cursor and Windsurf all register.
- **D2 — WSL:** the browser (on Windows) cannot tell that files live in WSL, so the backend reports it:
  `/api/status` gains `editor: { scheme, remote } | null` (additive; API v1 unchanged). With `remote = wsl+<distro>`
  the link is `<scheme>://vscode-remote/wsl+<distro>/<abs path>:<line>`.
- **D3 — config:** `MINDMELD_EDITOR` = `vscode` (default) · `vscode-insiders` · `cursor` · `windsurf` · `none`; a typo
  fails at start-up. The container image sets `none` (its paths are not the host's).
- **D4 — scope:** only `local` projects link; a git source's root is Studio's private clone.
- **D5 — encoding:** paths are `/`-separated and percent-encoded per segment; a Windows drive keeps its colon.

## Tests
- `packages/web/test/logic.test.ts`: local, WSL, Windows, encoding, git and no-editor cases.
- `packages/server/test/bootstrap.test.ts`: `editorFromEnv` and the `editor` field in a launched `/api/status`.
- `packages/web/test/e2e.test.ts`: the link's href after selecting `playTurn` (WSL remote form).
- Live (WSL): `vscode://vscode-remote/wsl+Ubuntu/…/fixtures/combat-game/src/game.ts:10`. Clicking it was not done
  here (it opens the owner's editor).
