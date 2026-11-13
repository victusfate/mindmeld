# Plan: Multi-language index

Vertical slices from [`prd.md`](prd.md). Granularity chosen by the model while the owner was away
(2026-11-13); the owner may regroup slices at review.

| # | Slice | Layers | Status |
|---|---|---|---|
| 1 | Code-first import budget: tiered admission, larger caps, `.rs`/`.py`/`.gd` recognized | core import | todo |
| 2 | Import scope: `include` on SourceRef → store column → Studio refresh → API → CLI | core, store, server, CLI | todo |
| 3 | Vendored grammars: wasm + manifest + regeneration script + checksum test + async loader | core, scripts | todo |
| 4 | Python adapter wired end to end: dispatch in `indexSources`, Studio `grammars` option, backend loads grammars, indexer version includes grammars, re-index on version change | core, server | todo |
| 5 | Rust adapter | core | todo |
| 6 | GDScript adapter | core | todo |
| 7 | Allowlist rejects non-JS/TS symbols | core, server | todo |
| 8 | Desktop ships grammars in packaged builds | desktop | todo |
| 9 | Standalone VS Code extension: embedded backend by default, `mindmeld.backend` setting | vscode | todo |

After slice 9: `/code-refiner` (auto-fix), then `/qa` — re-import voidhorizon through the API and the
extension, record per-language counts in `qa-report.md`.
