# QA report: multi-language-index

Run 2026-11-13 on `feat/multi-language-index`, standard tier. Target repo: `~/code/voidhorizon` (48k tracked files;
Rust, GDScript, Python, TypeScript; binary assets are Git LFS pointers and are never imported).

QA found 3 issues, fixed 3 (verified 3), deferred 1, blocked 1 (desktop Playwright e2e, below).

## Start commands
- Backend + browser: `MINDMELD_SANDBOX=none MINDMELD_MODEL_PROVIDER=none node packages/server/src/cli.ts --port 8799 --data <tmp> --project ~/code/voidhorizon`
- Browser probes: throwaway Playwright (Chromium) scripts outside the repo.
- VS Code: bundled `packages/vscode/dist/extension.cjs` run under VS Code's own WSL server Node (v24.22.1) with the test fake for the `vscode` API.
- Desktop: `electron --remote-debugging-port=9333 packages/desktop/dist/main.mjs`, queried over CDP; stopped by recorded PID.

## Outcome evidence (voidhorizon, whole repo)
| Measure | Before (main) | After |
|---|---|---|
| Files imported | 5,000 (3,503 JSON) | 18,112 (code first: 2,772 GDScript, 2,270 Python, 1,019 Rust, 663 TS) |
| Skipped | 11,175 by file limit | 4,124 data files by byte limit; no code file skipped |
| Symbols | 0 | 42,334 (GDScript 17,113 · Rust 11,522 · Python 11,255 · TS 2,339 · JS 105) |
| Static call edges | 0 | 84,975 (local 52,338 · import 15,864 · name-match 14,317 · this-member 2,456) |
| Import + index time | — | 8.3 s, ~1.0 GB RSS (in-memory store) |

## Issues
| ID | Severity | Surface | Summary | Status |
|---|---|---|---|---|
| QA-000 | high | design | 60% of edges were name matches, mostly library calls (`dict.get`, `list.append`, `get_tree().quit()`) linked to unrelated repo methods | fixed: design D6 revised (`b030941`); name matches now 17%, Rust-only |
| QA-001 | high | browser | 42k-symbol map rendered every node and froze the page; after a file was chosen, the map stayed empty | fixed (`22f9776`, `46d70a3`); e2e `large project…` |
| QA-002 | high | browser | a chosen file's symbols, placed by the whole-repo layout, could not fit on screen at minimum zoom | fixed (`ad49188`): layout runs on the shown symbols; e2e reproduces it on the old layout |
| QA-003 | low | CLI | an unknown flag prints a raw `ERR_PARSE_ARGS_UNKNOWN_OPTION` stack | deferred (pre-existing) |

## Probes that passed
- browser: open voidhorizon (first file shown, no console errors); choose `sim-core/src/abilities.rs` → 12 Rust symbols with `this-member` edges; click `AbilityState.can_activate` → source panel highlights lines 81–83, callee `AbilityState.get`.
- API: `include: ["sim-core","godot/scripts"]` → 94 files, none outside scope; refresh keeps scope; `include` as a string, `["../etc"]`, `[3]` → 400; allowlisting a Rust symbol → 400 "runs support TypeScript and JavaScript only"; no token → 401.
- CLI: `--include sim-core --include godot` → 4,470 files.
- VS Code bundle: activates with no Connect, reports the tree-sitter languages, indexes a Python and a TS symbol, serves the web UI (200), deactivates cleanly.
- Desktop bundle: `/api/status` reports `ts-index/1 … rust/0.24.0 python/0.25.0 gdscript/6.1.0`.

## Blocked
- `packages/desktop/test/e2e.test.ts` fails on `main` as well in this environment (Playwright 1.65 driving Electron 45:
  `Cannot read properties of undefined (reading '_object')`), so the desktop bundle was verified over CDP instead.

## Follow-ups (not in this PR)
- The TS indexer still name-matches unknown-receiver member calls (`push` 502, `max` 275 on voidhorizon); D6's rule could apply there too.
- A file with many unconnected symbols stacks into one column that can exceed the minimum zoom.
- The file filter lists every file (9k+ on voidhorizon); a directory picker would help large repos.
