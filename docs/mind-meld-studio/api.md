# Mind Meld Studio API — v1 (frozen)

Status: **locked 2026-11-10**. `API_VERSION = 1` and `API_ROUTES` in `packages/server/src/app.ts` are the
source of truth; `packages/server/test/contract.test.ts` fails on any breaking change. v1 may only grow
**additively** (new routes, new optional fields). Removing or renaming a route or field requires v2.
Types: `packages/core/src/schema.ts`, `usage.ts`, `diff.ts`. Typed client: `packages/client/src/index.ts`.

## Auth and transport

- Listens on `127.0.0.1:8787` by default (`MINDMELD_PORT`/`--port`; embedders such as the desktop app pick a random port). `Host` must be a loopback name (or `MINDMELD_ALLOWED_HOSTS`);
  a foreign `Origin` is refused (403), a foreign `Host` gets 421.
- Every `/api/*` route except `/api/health` needs `Authorization: Bearer <token>` **or** the `mm_token` cookie
  (HttpOnly, SameSite=Strict) set by `GET /auth?token=<token>` → 303 to `/`. Cookie-authenticated non-GET requests
  must carry a same-origin `Origin`.
- JSON in/out. Errors: `{ "error": string }` with 400 validation · 401 auth · 403 origin · 404 missing ·
  413 body too large (2 MB; bundles 60 MB) · 421 host · 422 rejected trace · 503 sandbox/model unavailable.

## Routes

| Route | Body / query | Returns |
| --- | --- | --- |
| `GET /api/health` (public) | — | `{ ok, apiVersion }` |
| `GET /auth?token=` | — | 303 + session cookie |
| `GET /api/status` | — | `{ apiVersion, indexer, sandbox{name,available,reason,runtime}, model{name,available,reason,model} }` |
| `GET /api/projects` | — | `Project[]` |
| `POST /api/projects` | `{ kind: 'local'\|'git', ref, name? }` | `{ project, snapshot }` |
| `GET /api/projects/:id` | — | `{ project, snapshot }` |
| `POST /api/projects/:id/refresh` | — | `RepoSnapshot` (new one if source changed → older runs become stale) |
| `GET /api/projects/:id/graph` | — | `{ project, snapshot, symbols, staticEdges, observedEdges, imports, staleRuns }` |
| `GET /api/projects/:id/source` | `?path=` | `{ path, hash, language, content }` |
| `GET /api/projects/:id/entries` | — | `Entry[]` (allowlist) |
| `POST /api/projects/:id/entries` | `{ symbolId, note? }` | `Entry` (exported functions only) |
| `GET /api/projects/:id/runs` | — | `Run[]` with `stale`, `staleFiles` |
| `POST /api/projects/:id/runs` | `{ entryId, inputs: unknown[], timeoutMs? }` | `{ run, events }` (503 without sandbox) |
| `POST /api/projects/:id/ask` | `{ question }` | `Answer` incl. `usage`, `limits?` (503 without model) |
| `GET /api/projects/:id/citation` | `?kind=symbol\|event&ref=&hash=` | `ResolvedCitation` |
| `GET /api/projects/:id/bundle` | — | sealed `EvidenceBundle` |
| `POST /api/bundles` | bundle JSON | `Project` (inspect-only; inconsistent or edited bundles → 400; imported runs carry `imported: true`) |
| `GET /api/runs/:id` | — | `{ run, events }` |
| `GET /api/runs/:a/diff/:b` | — | `RunDiff` |
| `GET /api/usage` | `?projectId=` | `UsageSummary` |
| `GET /api/usage/export` | `?projectId=` | JSONL (`application/x-ndjson`), one `UsageRecord` per line |

## Evidence semantics clients must keep

- `staticEdges` are *possible* calls (`resolution`: `local` · `import` · `this-member` · `name-match`);
  `observedEdges` come only from fresh recorded runs. Never present one as the other.
- `run.stale` / `staleFiles`: the run's source no longer matches the latest snapshot; still evidence of the past.
- `Answer.sentences[].supported === false` must be shown as unsupported; `abstained` answers start with `unknown`.
- `run.imported === true`: the run came from a bundle. The bundle hash is an unkeyed checksum (detects edits, not a
  forger who recomputes it), so present imported runs as third-party evidence, never as runs this Studio executed.
- Observed events are produced inside the untrusted process being traced; they show what the instrumented code
  reported, and a hostile repository could tamper with its own trace.

## Usage

`UsageSummary = { since, totals, windows: { fiveHour, sevenDay }, limits, groups, recent }`.
`totals`/window fields: `count, failed, durationMs, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
costUsd, unknownCost`. `windows` are rolling 5-hour / 7-day sums of Studio's own records. `limits` are the latest
provider-reported plan windows (`{ provider, window: 'five_hour'|'seven_day'|…, utilization 0..1, resetsAt, status,
reportedAt }`) — currently reported by the `claude` CLI only. Token/cost fields a CLI does not report are `null` on
records (unknown); `unknownCost` counts model calls without a cost, so cost totals are lower bounds when it is > 0.
