# Mind Meld Studio — prototype quickstart

Status: prototype. All interfaces talk to one localhost backend (`packages/server`).

## Prerequisites

- Node ≥ 23.6 (repo pins 26 in `.node-version`), `npm install` at the repo root.
- **Execution (optional):** a local Docker (or Podman: `MINDMELD_SANDBOX=podman`) daemon and the sandbox image,
  prepared once — Studio never pulls during a run: `docker pull node:26-alpine`.
  Without it, maps, source, replay of recorded/imported runs and citations still work; Run is disabled.
- **Q&A (optional):** a local agent CLI you are already logged into — `claude`, `codex`, `agy` or `pi`.
  Studio holds no API keys; it shells out to the CLI with tools disabled, prompt on stdin, in an empty temp dir.

## Backend + browser

```sh
npm run studio:start -- --project /path/to/repo      # prints http://127.0.0.1:8787/auth?token=…
```

Open the printed URL (it sets an HttpOnly session cookie). Data lives in `~/.mindmeld` (`--data DIR` to change).

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINDMELD_MODEL_PROVIDER` | `auto` | `auto` (first installed of claude, codex, agy, pi) · `claude` · `codex` · `agy` · `pi` · `none` |
| `MINDMELD_MODEL` | CLI default | passed as `--model` |
| `MINDMELD_MODEL_COMMAND` / `MINDMELD_MODEL_ARGS` | preset | override the CLI binary / JSON array of args (`{out}` = answer file); needed if the agy/pi presets don't match your version |
| `MINDMELD_SANDBOX` | `docker` | `docker` · `podman` · `none` |
| `MINDMELD_SANDBOX_IMAGE` | `node:26-alpine` | local image used for runs |
| `MINDMELD_ALLOWED_ROOTS` | (any) | comma-separated directories projects may be imported from |
| `MINDMELD_PORT` / `MINDMELD_TOKEN` / `MINDMELD_DATA_DIR` | 8787 / random / `~/.mindmeld` | |

Try it on the bundled fixture: `npm run studio:start -- --project fixtures/combat-game`, allowlist
`src/game.ts#playTurn`, run with `[{"name":"hero","hp":10,"attack":7,"armor":1},{"name":"slime","hp":5,"attack":2,"armor":2}]`,
then again with `"attack":120` and compare: `legacyCritical` appears only in the second run.

## Usage tracking (share it back)

Every index, sandbox run and model call is recorded (duration, success, tokens/cache/cost as the CLI reports them;
unreported values are *unknown*, not zero).

```sh
node packages/server/src/cli.ts --usage            # human-readable summary
node packages/server/src/cli.ts --usage --json     # JSONL, one record per line — attach this when sharing
```

Also `GET /api/usage` and `GET /api/usage/export` (JSONL), and in each interface's usage view.

## Desktop, VS Code, container

See `packages/desktop/README.md`, `packages/vscode/README.md` and `infra/compose/compose.yml`
(the container cannot use your host's CLI login, so Q&A is off there; run natively for Q&A).
