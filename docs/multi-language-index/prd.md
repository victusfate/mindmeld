# PRD: Multi-language index

Design and decisions: [`design.md`](design.md) (D1–D9). Vocabulary follows its table.

## Problem Statement
Pointing Mind Meld Studio at a real game repo (`~/code/voidhorizon`: Rust simulation, Godot/GDScript client,
Python tooling, a TypeScript web app) produces an empty map: 0 symbols, 0 edges. Only TypeScript and
JavaScript are indexed, and the 5,000-file import cap is used up alphabetically by JSON and Markdown before
any code is reached. The VS Code extension also cannot be used on its own: it needs a separately started
backend and a pasted login URL.

## Solution
Importing voidhorizon (or any repo mixing these languages) shows functions, classes and methods from Rust,
Python and GDScript alongside TS/JS, with possible call edges between them, source spans that open the right
lines, and citations/Q&A over them. Code files win the import budget over data files, the budget is larger,
and an import can be narrowed to some directories. Installing the VS Code extension is enough to use it: it
starts its own backend.

## Outcome and Evidence
- Observable improvement: re-importing voidhorizon yields non-zero symbols and call edges for each of Rust,
  Python, GDScript and TS; no code file is skipped for budget while data files were admitted.
- Assumptions and probes: listed in `design.md` §Assumptions (cap size, name-match bound; `node:sqlite` in
  the extension host is verified). Unknown until the voidhorizon re-import is measured.
- Revise the design if: import of voidhorizon takes minutes or exhausts memory (lower caps, lean on scope);
  name-match edges dominate the graph (lower or drop the bound); tree-sitter grammars fail to load inside
  the packaged desktop app or .vsix.
- Preservation obligations: API v1 contract tests (`packages/server/test/contract.test.ts`); TS symbol ids and
  instrumentation (`packages/core/test/import-index.test.ts`, `studio.test.ts`); store migrations stay
  forward-only (`packages/core/src/store.ts` `MIGRATIONS`).

## User Stories
1. As a developer studying a Rust codebase, I want its functions, impl methods, structs, enums and traits on
   the map, so that I can navigate it like a TS project.
2. As a developer studying Python tooling, I want functions, classes and methods indexed, with
   `from m import f` calls linked to the right file, so that call paths are traceable.
3. As a Godot developer, I want GDScript `func`s and inner classes indexed, with `self.x()` and same-file calls
   linked, so that game scripts appear on the map.
4. As a user of a repo with thousands of JSON/Markdown files, I want code files imported before data files,
   so that the budget never starves the code.
5. As a user of a very large repo, I want to import only some directories, so that noise (generated
   experiments, vendored plugins) stays out.
6. As a user, I want a re-import after upgrading Studio to re-index even if the source did not change, so
   that new language support shows up on existing projects.
7. As a user, I want common method names (`new`, `get`, `_ready`) not to wire every file together, so that
   the graph stays readable.
8. As a user, I want allowlisting a Rust/Python/GDScript function to fail with a clear reason, so that I know
   runs are JS/TS-only.
9. As a VS Code user, I want the extension to work right after install, with no server to start or URL to
   paste, so that I can import my workspace immediately.
10. As a VS Code user with a shared or remote backend, I want a setting to keep using an external server.
11. As a VS Code user in a WSL window, I want importing the workspace to work, so that Linux paths reach a
    backend that can read them.
12. As a user, I want files that fail to parse to contribute what they can and never fail the import.

## Implementation Decisions
- **Language detection:** `Language` gains `rust`, `python`, `gdscript` (extensions `.rs`, `.py`, `.gd`).
  Additive to API v1 output.
- **Import (core):** two-phase walk — list candidates, filter by import scope, order by tier then path, admit
  within the budget, then read and hash. New defaults 20,000 files / 150 MB / 1 MB per file. Skipped entries
  keep their existing reasons.
- **Import scope:** `include?: string[]` of safe repo-relative directory paths on `SourceRef`, stored in a new
  nullable `include_paths` column (forward migration), honored on refresh, exposed on `Project` as
  `include?: string[]`. `POST /api/projects` accepts optional `include`; the CLI gains repeatable `--include`.
- **Language adapters (core):** one module per language over a shared tree-sitter runtime; each returns
  symbols plus call sites (callee name, receiver kind, span) for the shared edge resolver. TS keeps the
  TypeScript compiler path unchanged.
- **Grammars:** vendored `.wasm` under core with a manifest (package, version, license, sha256) and a
  regeneration script. Loaded once, asynchronously, at backend start; Studio receives the loaded grammars
  through its options. Without grammars, new-language files are imported as files but yield no symbols.
- **Edge resolution:** `local`, `this-member`, `import` (Python), and bounded `name-match`
  (`NAME_MATCH_LIMIT = 3`).
- **Indexer version:** includes the grammar set; a re-import reuses the latest snapshot only if both the
  source hash and the indexer version match.
- **Allowlist:** rejects symbols whose file language is not TS/JS.
- **Standalone extension:** setting `mindmeld.backend: "embedded" | "external"` (default embedded). Embedded
  starts the backend via the server's `launch()` in the extension host (127.0.0.1, port 0, random token,
  data in global storage), connects the session, and shuts it down on deactivate. The .vsix bundles backend,
  web UI and grammars.
- **Desktop:** packaged builds ship the grammar files next to the web UI.

## Testing Decisions
- Good tests here drive public entry points with small fixture sources and assert on observable outputs
  (symbol ids/kinds/spans, edges with resolutions, admitted/skipped paths), never on parser internals.
- Modules tested (owner away during PRD; chosen by the model, revisit freely):
  - core import: tier ordering, budget, scope, unsafe scope rejection — extend `import-index.test.ts`.
  - each language adapter: symbols, kinds, exported/async, spans, call edges, parse-error tolerance —
    new `languages.test.ts` with inline fixtures.
  - Studio: re-index on indexer-version change, allowlist language check, scope persisted on refresh —
    `studio.test.ts`.
  - store migration: old database opens and gains the column — existing store tests' pattern.
  - server: `include` accepted and validated; contract test still green — `server.test.ts`, `contract.test.ts`.
  - grammars manifest: every vendored file's sha256 matches — small test in core.
  - VS Code: embedded backend starts and connects; external setting keeps Connect — `extension.test.ts`
    with the existing fake-vscode harness.
- Prior art: `packages/core/test/helpers.ts` temp repos; `packages/vscode/test/fake-vscode.ts`.
- Reproduction trace: import voidhorizon via the API and record file/symbol/edge counts per language
  (qa-report).

## Out of Scope
- Running or tracing Rust, Python or GDScript code (sandbox and instrumentation stay JS/TS).
- Rust `use`-path, GDScript `preload`/`class_name` resolution, Python relative-package edge cases beyond
  `from .m import f` within the repo.
- UI for editing import scope (web, desktop, extension).
- Moving TS/JS to tree-sitter.

## Further Notes
- Desktop zoom fix lives on its own branch (`fix/desktop-font-size`).
- Caps (D7) and scope (D8) were decided while the owner was away; flag them in the PR for review.
