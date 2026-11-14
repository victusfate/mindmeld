# TDD log: multi-language-index

## Slice 1 — code files win the import budget
- Status: done
- Notes: two-phase import (list → tier sort → admit → read); caps 20,000 files / 150 MB.

## Slice 2 — import scope
- Status: done
- Notes: `include` on SourceRef, `include_paths` column (migration 3, checked against a copy of a real store),
  `POST /api/projects` `include`, CLI `--include`.

## Slice 3 — vendored grammars
- Status: done
- Notes: `build-grammars.ts` regenerates wasm + manifest; GDScript built with tree-sitter-cli 0.27.2 (no Docker
  needed); loader verifies sha256 and frees trees via `withTree`.

## Slice 4 — Python adapter end to end
- Status: done
- Notes: `indexSources(files, contents, grammars?)`; indexer version includes grammar versions; Studio re-indexes
  when it changes (old snapshots were reused on hash match alone).

## Slice 5 — Rust adapter
- Status: done

## Slice 6 — GDScript adapter
- Status: done
- Notes: implicit self for bare calls inside a class/script.

## Slice 7 — allowlist rejects non-JS/TS
- Status: done

## Slice 8 — desktop ships grammars
- Status: done
- Notes: launch() takes `grammarFiles`; runtime wasm passed as bytes (works inside asar). The Playwright e2e
  fails on main too here (Playwright 1.65 + Electron 45), so the bundle was verified over CDP instead:
  `/api/status` indexer reports rust/python/gdscript.

## Slice 9 — standalone VS Code extension
- Status: done
- Notes: embedded backend by default (`mindmeld.backend`); bundle smoke-tested under VS Code's WSL server Node
  v24.22.1 (activate → index Python + TS → web UI 200 → deactivate).

## Revision — D6 name matches
- Status: done
- Notes: voidhorizon measurement: 165,083 → 84,975 edges; name matches 60% → 17% (now Rust qualified/free
  functions only); GDScript `class_name` calls resolve as imports.
