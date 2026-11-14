# Mind Meld Studio

Learn an unfamiliar codebase from evidence, not guesses. Point Mind Meld Studio at a repository and you get:

- **A source-linked map** of modules, symbols and the calls between them, built from a static index. Nothing is executed or installed to draw it.
- **Real runs you can replay.** Pick an allowlisted entry point, give it inputs, and Studio runs it in a locked-down container and records what was actually called. Step through the trace or compare two runs side by side.
- **Answers with citations.** Ask a question and a local agent CLI you're already logged into (`claude`, `codex`, `agy` or `pi`) answers from the indexed source and recorded runs. Each sentence cites the code or trace it rests on, and anything it can't support is marked *unknown*.

It runs as a browser app, an Electron desktop app or a VS Code extension. The browser uses a local backend you start; the desktop app and the extension run their own.

It indexes TypeScript, JavaScript, Rust, Python and GDScript; runs are TypeScript/JavaScript only.

> **Status:** prototype. The localhost API (v1) is frozen; everything else may change.

## What it promises

- Static *possible* calls, *observed* runtime calls and model *interpretations* are kept apart, in the data and on screen.
- No invented events, values or results. If the evidence isn't there, the answer says **unknown**. A call that wasn't observed isn't proof it can't happen.
- The repository you're reading is treated as untrusted. Runs are allowlisted, have no network, mount the source read-only, are resource-bounded, and refuse to run at all without a container sandbox.
- Every recording is tied to the source hashes, inputs and sandbox policy it came from, and goes visibly stale when the code changes.
- No API keys. The model is optional: maps, traces, replay and citations all work offline.
- Secrets are redacted before anything is stored or sent to a model.

## Quick start

Needs Node 26 (see `.node-version`; Node 23.6 or newer works).

```sh
npm install
npm run studio:build
npm run studio:start -- --project fixtures/combat-game
```

Open the printed `http://127.0.0.1:8787/auth?token=…` URL. To run code you also need Docker or Podman and a local copy of the sandbox image (`docker pull node:26-alpine`). Without it, everything except Run still works.

The full walkthrough, with configuration, the desktop and VS Code apps, the container image and usage export, is in [`docs/mind-meld-studio/quickstart.md`](docs/mind-meld-studio/quickstart.md).

## Repository layout

| Path | What's there |
| --- | --- |
| `packages/core` | Evidence engine: safe repo import, TypeScript and tree-sitter (Rust, Python, GDScript) indexers, run recording, SQLite store, staleness, cited Q&A, bundles, usage |
| `packages/connectors` | Docker/Podman sandbox, local agent-CLI model connector, local and git sources |
| `packages/server` | Localhost API v1 with token/cookie auth ([`api.md`](docs/mind-meld-studio/api.md)) |
| `packages/client` | Typed API client |
| `packages/web` | Browser UI (React) |
| `packages/desktop` | Electron app |
| `packages/vscode` | VS Code extension |
| `infra/` | Container image, compose files, sandbox image, smoke test |
| `fixtures/combat-game` | Small sample repo for trying Studio out |
| `docs/mind-meld-studio/` | Design, API and quickstart |

## Development

```sh
npm run studio:typecheck
npm run studio:test        # all workspace suites
npm run studio:coverage    # with per-package coverage floors
npm run lint
```

Some tests run only when their dependency is available: the real Docker sandbox, Playwright for the browser end-to-end test, and `RUN_MINDMELD_CLI_MODEL=1` for a real `claude` CLI call.

This repo is built on [victusfate/scaffold](https://github.com/victusfate/scaffold). Coding agents working here follow [`AGENTS.md`](AGENTS.md), and the skills behind that workflow are listed in [`docs/skills.md`](docs/skills.md).

## License

MIT. See [`LICENSE`](LICENSE).
