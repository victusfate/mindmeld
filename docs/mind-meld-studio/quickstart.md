# Mind Meld Studio — prototype quickstart

Status: prototype. Studio is a browser UI (`packages/web`) served by a localhost backend (`packages/server`) that
you start with one command.

## Prerequisites

- Node ≥ 23.6 (repo pins 26 in `.node-version`), `npm install` at the repo root.
- **Execution (optional):** a local Docker (or Podman: `MINDMELD_SANDBOX=podman`) daemon and the sandbox image,
  prepared once — Studio never pulls during a run: `docker pull node:26-alpine`.
  Without it, maps, source, replay of recorded/imported runs and citations still work; Run is disabled.
- **Q&A (optional):** a local agent CLI you are already logged into — `claude`, `codex`, `agy` or `pi`.
  Studio holds no API keys; it shells out to the CLI with tools disabled, prompt on stdin, in an empty temp dir.

## Backend + browser

```sh
npx mindmeld /path/to/repo        # imports the repo and opens http://127.0.0.1:8787/auth?token=… in your browser
```

`mindmeld [PATH…] [--include DIR]… [--port N] [--host H] [--data DIR] [--no-open]`. The printed URL sets an HttpOnly
session cookie and opens the last PATH. A PATH imported before (same directory and `--include` scope) is refreshed,
not imported again. Without `--port` or `MINDMELD_PORT`, a busy 8787 falls back to a free port. The browser opens
only from a terminal; `--no-open` skips it. `npm link -w @mindmeld/server` puts `mindmeld` on your PATH.
Data lives in `~/.mindmeld` (`--data DIR` to change).

Indexed languages: TypeScript/JavaScript (TypeScript compiler) and Rust, Python and GDScript (tree-sitter grammars
vendored in `packages/core/grammars`). JSON, Markdown and text files are imported for citations and Q&A only.
Runs are TypeScript/JavaScript only. An import admits code files before data files, up to 20,000 files / 150 MB;
narrow a large repo with `--include DIR` (repeatable, repo-relative) or `include` on `POST /api/projects`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINDMELD_MODEL_PROVIDER` | `auto` | `auto` (first installed of claude, codex, agy, pi) · `claude` · `codex` · `agy` · `pi` · `none` |
| `MINDMELD_MODEL` | CLI default | passed as `--model` |
| `MINDMELD_MODEL_COMMAND` / `MINDMELD_MODEL_ARGS` | preset | override the CLI binary / JSON array of args (`{out}` = answer file); needed if the agy/pi presets don't match your version |
| `MINDMELD_SANDBOX` | `docker` | `docker` · `podman` · `none` |
| `MINDMELD_SANDBOX_IMAGE` | `node:26-alpine` | local image used for runs |
| `MINDMELD_ALLOWED_ROOTS` | (any) | comma-separated directories projects may be imported from |
| `MINDMELD_PORT` / `MINDMELD_TOKEN` / `MINDMELD_DATA_DIR` | 8787 / random / `~/.mindmeld` | |

Try it on the bundled fixture: `npx mindmeld fixtures/combat-game`, allowlist
`src/game.ts#playTurn`, run with `[{"name":"hero","hp":10,"attack":7,"armor":1},{"name":"slime","hp":5,"attack":2,"armor":2}]`,
then again with `"attack":120` and compare: `legacyCritical` appears only in the second run.

## Agents (MCP)

`mindmeld mcp [PATH]` serves one repo's index to an agent over stdio (PATH defaults to the current directory; it
is imported or refreshed first, in the same data dir as the browser). Tools: `overview`, `find_symbols`, `symbol`
(source, static callers/callees with how each was resolved, calls seen in runs), `file_symbols`, `refresh`.

```sh
npm link -w @mindmeld/server                      # once, so agents can start `mindmeld`
claude mcp add mindmeld -- mindmeld mcp /path/to/repo
codex mcp add mindmeld -- mindmeld mcp /path/to/repo
```

Any MCP client works the same way: command `mindmeld`, args `["mcp", "/path/to/repo"]` (Cursor:
`.cursor/mcp.json`). Without `npm link`, use `node /path/to/mindmeld/packages/server/src/cli.ts mcp /path/to/repo`.

## Usage tracking (share it back)

Every index, sandbox run and model call is recorded (duration, success, tokens/cache/cost as the CLI reports them;
unreported values are *unknown*, not zero).

```sh
npx mindmeld --usage            # human-readable summary
npx mindmeld --usage --json     # JSONL, one record per line — attach this when sharing
```

Also `GET /api/usage` and `GET /api/usage/export` (JSONL), and in the browser's usage panel.

## Browser UI

```sh
npm run studio:build                                   # builds packages/web/dist
npx mindmeld fixtures/combat-game                       # opens the browser on the fixture
```

## Container

See `infra/compose/compose.yml`. A container cannot use your host's CLI login, so Q&A is off there; run natively
for Q&A.

## npm install-script policy

npm reports that `esbuild` has an install script not covered by `allowScripts`. Builds and tests pass without running them here; approving them (`npm install-scripts approve <pkg>`)
is an owner decision.
