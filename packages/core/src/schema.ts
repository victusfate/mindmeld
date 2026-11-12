// Evidence contracts (schema version 2). Static edges are *possible* relationships; observed edges come only
// from recorded events; model output is an interpretation that must cite one of the two or say "unknown".

import type { ModelUsage, ProviderLimit } from './usage.ts';

export const SCHEMA_VERSION = 2;

export interface SourceFile { path: string; hash: string; bytes: number; language: Language }
export type Language = 'typescript' | 'javascript' | 'json' | 'markdown' | 'text';

export interface RepoSnapshot {
  id: string;
  projectId: string;
  snapshotHash: string;
  createdAt: string;
  indexerVersion: string;
  files: SourceFile[];
  skipped: SkippedFile[];
}
export interface SkippedFile { path: string; reason: string }

export interface Span { file: string; startLine: number; endLine: number }

export type SymbolKind = 'function' | 'class' | 'method' | 'variable-function';
export interface CodeSymbol {
  /** Stable within a snapshot: `<file>#<qualifiedName>`. */
  id: string;
  name: string;
  kind: SymbolKind;
  exported: boolean;
  async: boolean;
  params: string[];
  span: Span;
  fileHash: string;
}

/** How the indexer linked a call site to a target. `name-match` is the weakest: any member with that name. */
export type EdgeResolution = 'local' | 'import' | 'this-member' | 'name-match';
export interface StaticEdge {
  provenance: 'static';
  from: string;
  to: string;
  kind: 'call' | 'import';
  resolution: EdgeResolution;
  site: Span;
}

export interface ObservedEdge {
  provenance: 'observed';
  from: string;
  to: string;
  runIds: string[];
  count: number;
}

export interface Entry { id: string; projectId: string; symbolId: string; createdAt: string; note: string }

export type RunStatus = 'ok' | 'error' | 'timeout';
export interface SandboxIdentity { connector: string; image: string; network: 'none'; memoryMb: number; timeoutMs: number }
export interface Run {
  id: string;
  projectId: string;
  snapshotId: string;
  snapshotHash: string;
  entrySymbol: string;
  inputs: string;
  status: RunStatus;
  output: string;
  error: string | null;
  stdout: string;
  truncated: boolean;
  createdAt: string;
  durationMs: number;
  sandbox: SandboxIdentity;
  runtimeVersion: string;
  /** Hashes of every file in the executed snapshot: editing any of them makes the run stale. */
  fileHashes: Record<string, string>;
  /** Set on runs that came from an imported bundle: replayable evidence, but not executed by this Studio. */
  imported?: boolean;
  /** Present when the run is read back: whether its source still matches the latest snapshot. */
  stale?: boolean;
  staleFiles?: string[];
}

export interface TraceEvent {
  runId: string;
  seq: number;
  symbol: string;
  parent: number | null;
  depth: number;
  args: string;
  result: string;
  threw: boolean;
  async: boolean;
  /** Serialized receiver before/after a method call; null when unchanged or not a method. */
  thisBefore: string | null;
  thisAfter: string | null;
  startMs: number;
  durationMs: number;
}

export type Freshness = 'fresh' | 'stale' | 'missing';
export interface CitationRef { kind: 'symbol' | 'event'; ref: string }
export interface ResolvedCitation extends CitationRef {
  valid: boolean;
  freshness: Freshness;
  span: Span | null;
  fileHash: string | null;
  label: string;
}

export interface AnswerSentence { text: string; citations: string[]; supported: boolean }
export interface Answer {
  question: string;
  abstained: boolean;
  /** Displayable text. When abstained, starts with "unknown". */
  text: string;
  sentences: AnswerSentence[];
  citations: ResolvedCitation[];
  unknowns: string[];
  assumptions: string[];
  model: string | null;
  /** Model usage for this answer as reported by the CLI (null fields = not reported). No model call → zeros. */
  usage: ModelUsage | null;
  /** Provider plan windows reported with this answer (e.g. five_hour, seven_day); absent/null when unknown. */
  limits?: ProviderLimit[] | null;
}
