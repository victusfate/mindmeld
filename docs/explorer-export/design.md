# Explorer export: a shareable code-map page from the index

Uses the scaffold's explorer renderer (`scripts/explorer-render.ts`, `skills/diagram.md` Mode G) so a repo's map
can be handed to someone who installs nothing.

## Decisions
- **D1 — command:** `mindmeld explorer [PATH] [--out DIR]` writes `<slug>.explorer.json` (source of truth) and
  `<slug>.explorer.html` (rendered). PATH is imported or refreshed like the other commands.
- **D2 — deterministic content only:** nodes, lanes, roles, details and flows are counted from the graph. No model is
  called; an agent can add prose to the JSON and re-render. The renderer's `validateSpec` gates every generated spec.
- **D3 — modules:** ≤24 files → one node per file. Otherwise start at top-level directories and repeatedly split the
  directory with the most symbols into its subdirectories while the total stays ≤24 (`groupFiles`).
- **D4 — lanes:** a node's top-level directory; beyond 8, the lanes with the fewest symbols merge into `other`.
- **D5 — calls:** `name-match` edges are excluded; a newcomer's map shows only resolved calls.
- **D6 — flows:** depth-first static chains from symbols nothing calls, recording only module-crossing calls (≤8
  steps); kept if they touch ≥3 modules; best 3 by modules touched, then length.
- **D7 — packaging:** the renderer stays in `scripts/` (scaffold-owned, reused not copied). The CLI loads it on
  demand, so the container image (which ships `packages/` only) still starts; `explorer` there is unsupported.

## Evidence
- `packages/server/test/explorer.test.ts`: fixture (files as nodes, game→combat→damage flow, name-match excluded),
  synthetic large repo (split busiest directory, ≤24 nodes, ≤8 lanes), no-symbol refusal, CLI writes both files.
- voidhorizon: 9.5 s including import; 24 modules in 8 lanes (sim-core, godot, campaign-core, …); one flow
  (scripts/reports.ts `main` → infra, scripts/lib). Desktop and 390 px pages render with no console errors and no
  horizontal scroll.
