# Mind Meld Studio — Initial Design and Implementation Backlog

> **Superseded in part (2026-11-14):** the desktop app and the VS Code extension were retired; Studio is the
> browser UI only. See [`../retire-desktop-vscode/design.md`](../retire-desktop-vscode/design.md).

**Status:** Draft · 2026-11-10  
**Repository:** [victusfate/mindmeld](https://github.com/victusfate/mindmeld)  
**License:** MIT (see repository root `LICENSE`)  
**Foundation:** [victusfate/scaffold](https://github.com/victusfate/scaffold)

## Product outcome

A reader points Mind Meld Studio at an unfamiliar repository, browses a source-linked architecture map, steps through a real sandboxed execution, watches observed flow animate, and asks a local LLM questions answered with verifiable citations. Desktop and browser interfaces are first-class; the CLI is an implementation interface, not the product.

**Outcome measurement:** Newcomers answer a fixed set of code-flow questions using the tool versus a control without it. Measure accuracy, time, and unsupported claims. Do not claim improvement before measuring.

## Non-negotiable invariants

1. Distinguish static *possible* edges, observed runtime edges, and model interpretations in schema and UI.
2. Never fabricate events, values, timing, calls, or results. Unsupported explanations explicitly say **unknown**.
3. Source repositories are untrusted. Execution is allowlisted, sandboxed, bounded, network-disabled by default, and fails closed without isolation.
4. Indexing and browsing must work without executing code or installing dependencies.
5. Source hashes, adapter/runtime versions, inputs, and sandbox policy bind every recording; stale evidence is visible.
6. The local LLM is optional. Maps, traces, replay, and citations work offline without it.
7. Redact secrets and sensitive data before storing traces or sending context to a local model.
8. An absent observed call is not proof that a call is impossible.

## Reuse from scaffold

- `skills/mind-meld.md`: learning IDE method and adapter contract.
- `scripts/mind-meld.ts`: reference indexing, real execution, run comparison, verification, and offline viewer.
- `scripts/mind-meld-schema.ts`: validated, versioned evidence bundle.
- `scripts/mind-meld-sandbox.ts`: fail-closed isolated execution reference.
- `feature-chain → co-plan → to-prd → tdd → review`: planning, implementation, and quality workflow.
- Keep upstream `AGENTS.md` scaffold-owned; put product instructions in `AGENTS.local.md`.

**Strategy:** Extract and generalize the reference implementation, not rewrite it. Existing scaffold code is reference functionality, not proof that a general-purpose product already exists.

## Proposed architecture (decisions pending ADRs)

| Layer | Candidate | Notes |
| --- | --- | --- |
| Desktop | Tauri 2 + React + TypeScript | Validate platform support and sandbox boundaries |
| Browser | Localhost backend + React | Restrict origins and authenticate local API |
| Graph | XYFlow / React Flow | Distinct observed/static/inferred edge styles |
| Source | Monaco | Exact source spans and hash identity |
| Static analysis | Tree-sitter + semantic adapters | Syntax alone cannot prove dynamic call targets |
| Debugging | Debug Adapter Protocol + instrumentation | Capability negotiation; no uniform debugger assumptions |
| Core | Rust | Orchestration, evidence validation, persistence, isolation lifecycle |
| Storage | SQLite + content-addressed bundles | Outside studied repository |
| Local AI | Ollama; compatible local endpoints | Evidence-constrained retrieval, abstention |
| Isolation | Rootless OCI or VM where appropriate | No unsafe host fallback |

### Evidence contracts

- `RepoSnapshot`: revision, source hashes, adapter versions, snapshot identity.
- `Symbol`: snapshot-scoped ID, language, kind, exact source span.
- `StaticEdge`: source-backed possible relationship, type and provenance.
- `Run`: allowlisted entry, snapshot, inputs/fakes, runtime/sandbox identity, status.
- `TraceEvent`: observed sequence, parent/call stack, source span, bounded/redacted values.
- `EvidenceCitation`: source hash and span or recorded event ID, freshness state.
- `Answer`: explanation, resolvable citations, assumptions, unknowns.

Use the scaffold's executable schema as baseline and evolve with versioned migrations.

## Implementation backlog

### Phase 0 — Repository and governance
- [x] **P0-01** Create public MIT `victusfate/mindmeld` from scaffold template.
- [ ] **P0-02** Replace scaffold README with product overview, security model and quickstart; retain MIT license.
- [ ] **P0-03** Add `AGENTS.local.md`, product-specific conventions and acceptance gates; verify scaffold sync.
- [ ] **P0-04** Split this plan into `docs/mind-meld-studio/design.md`, `prd.md`, `plan.md`, ADRs, threat model and outcome-study protocol.
- [ ] **P0-05** Configure Rust/TS CI, lint, tests, dependency scans and scaffold quality checks.
- [ ] **P0-06** Turn ordered work packages into GitHub issues with dependencies and milestone labels.

### Phase 1 — Evidence-first end-to-end MVP
- [ ] **P1-01** Extract scaffold reference contracts into a versioned library, retaining tests.
- [ ] **P1-02** Import repositories safely: ignore rules, symlink escape prevention, file limits and hashes.
- [ ] **P1-03** Index TypeScript symbols, imports, calls and source spans without executing code.
- [ ] **P1-04** Build SQLite snapshot/evidence store with migrations and immutable trace artifacts.
- [ ] **P1-05** Implement allowlisted sandbox runner: no network, bounded resources, safe cleanup.
- [ ] **P1-06** Adapt scaffold's real combat example; capture successful, contrasting and failed runs.
- [ ] **P1-07** Build interactive graph with filtering, pan/zoom, search, provenance styles and source navigation.
- [ ] **P1-08** Build replay timeline: step, call stack, inputs, outputs, mutations and animated observed path.
- [ ] **P1-09** Implement citation resolver, source-hash verification and stale/unknown states.
- [ ] **P1-10** Integrate local Ollama Q&A with validated citations and abstention.
- [ ] **P1-11** Package desktop and safe localhost browser UI.
- [ ] **P1-12** Deliver guided demo and run fixed-question newcomer comprehension study.

### Phase 2 — Language expansion and real debugging
- [ ] **P2-01** Versioned index/execution adapter SDK, capabilities and conformance tests.
- [ ] **P2-02** Python static index and debugpy DAP adapter.
- [ ] **P2-03** Rust semantic index and instrumented integration-test traces.
- [ ] **P2-04** Godot/GDScript index, headless runner, trace hooks and isolated user data.
- [ ] **P2-05** DAP breakpoints, step, stack and scoped variables; report unsupported capabilities.
- [ ] **P2-06** Compare executions and visually branch across inputs or snapshots.
- [ ] **P2-07** Validate realistic repos, mixed languages and dependency failures.

### Phase 3 — Product maturity
- [ ] **P3-01** Architecture clustering, module views, graph expansion and performance controls.
- [ ] **P3-02** Guided cited tours, bookmarks and portable offline evidence bundles.
- [ ] **P3-03** Evidence-aware question-to-allowlisted-run proposals; never model-to-shell.
- [ ] **P3-04** Search and semantic retrieval preserving source provenance.
- [ ] **P3-05** Windows/macOS/Linux packaging, signing, update and reproducibility strategy.
- [ ] **P3-06** Accessibility, keyboard support and large-repo latency/memory benchmarks.
- [ ] **P3-07** Security probes: malicious repos, parsers, prompt injection, exfiltration and escapes.
- [ ] **P3-08** Public docs, examples, adapter contributor guide and release checklist.

## Critical release gates

- Static edges cannot be represented as observed edges, including misleading call-site fixtures.
- No successful trace without actual sandboxed execution and recorded events.
- Sandbox unavailable means execution unavailable; static inspection still works.
- Execution cannot access network, source writes, host credentials or unlimited resources.
- Editing source invalidates affected evidence; malformed or forged imported bundles are rejected.
- AI answers cite resolvable spans/events or abstain; prompt-injection tests are mandatory.
- A documented clean-machine demo works with the model disabled for evidence inspection.
- Comprehension outcome is measured against control, not asserted.

## MVP definition of done

On a clean machine, a user opens the bundled TypeScript fixture, sees a source-linked map, runs an allowlisted sandboxed flow, replays a real trace, compares two runs, and asks a local model a question with validated citations. Turning off the model preserves inspection. Turning off the sandbox blocks execution. Editing source marks old traces stale.

## Architecture decisions to resolve

- **ADR-001:** Rust/Tauri versus TypeScript-only core.
- **ADR-002:** OS-specific sandbox policies and threat boundaries.
- **ADR-003:** Versioned evidence schema and adapter protocol.
- **ADR-004:** Trace capture overhead and value redaction.
- **ADR-005:** Browser-mode origin/auth security and local model lifecycle.
- **ADR-006:** Language capability matrix and supported feature levels.

**Suggested critical path:** P0-02/03/04/05 → P1-01/02 → P1-03/04 → P1-05/06 → P1-07/08/09 → P1-10/11/12. Defer Phase 2 and 3 expansion until MVP evidence and isolation gates pass.
