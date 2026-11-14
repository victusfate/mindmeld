# Plan: Multi-language index

Vertical slices from [`prd.md`](prd.md). Granularity chosen by the model while the owner was away
(2026-11-13); the owner may regroup slices at review.

| # | Slice | Layers | Status |
|---|---|---|---|
| 1 | Code-first import budget: tiered admission, larger caps, `.rs`/`.py`/`.gd` recognized | core import | done |
| 2 | Import scope: `include` on SourceRef → store column → Studio refresh → API → CLI | core, store, server, CLI | done |
| 3 | Vendored grammars: wasm + manifest + regeneration script + checksum test + async loader | core, scripts | done |
| 4 | Python adapter wired end to end: dispatch in `indexSources`, Studio `grammars` option, backend loads grammars, indexer version includes grammars, re-index on version change | core, server | done |
| 5 | Rust adapter | core | done |
| 6 | GDScript adapter | core | done |
| 7 | Allowlist rejects non-JS/TS symbols | core, server | done |
| 8 | Desktop ships grammars in packaged builds | desktop | done |
| 9 | Standalone VS Code extension: embedded backend by default, `mindmeld.backend` setting | vscode | done |

After slice 9: `/code-refiner` (auto-fix), then `/qa` — re-import voidhorizon through the API and the
extension, record per-language counts in `qa-report.md`.

Revision after slice 9: measuring voidhorizon disproved the name-match assumption (60% of edges were library
calls name-matched to repo methods), so D6 was revised and slices 4–6 resolution updated (commit `b030941`).

Later (2026-11-14): the desktop app and the VS Code extension were retired, so slices 8 and 9 no longer ship;
see [`../retire-desktop-vscode/design.md`](../retire-desktop-vscode/design.md).
