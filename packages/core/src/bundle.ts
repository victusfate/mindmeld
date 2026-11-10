// Portable offline evidence bundle. Import recomputes every hash and re-validates every span and event,
// so a forged or edited bundle is rejected instead of being shown as evidence.
import { sha256, snapshotHashOf } from './hash.ts';
import { isSafeRelativePath } from './import.ts';
import { parseTrace } from './runner.ts';
import type { CodeSymbol, Run, SourceFile, StaticEdge, TraceEvent } from './schema.ts';
import { SCHEMA_VERSION } from './schema.ts';

export interface EvidenceBundle {
  kind: 'mindmeld-bundle';
  version: number;
  name: string;
  snapshotHash: string;
  indexerVersion: string;
  files: SourceFile[];
  sources: Record<string, string>;
  symbols: CodeSymbol[];
  edges: StaticEdge[];
  runs: Run[];
  events: Record<string, TraceEvent[]>;
  bundleHash: string;
}

const MAX_BUNDLE_FILES = 5000;

export function sealBundle(b: Omit<EvidenceBundle, 'bundleHash' | 'kind' | 'version'>): EvidenceBundle {
  const body = { kind: 'mindmeld-bundle' as const, version: SCHEMA_VERSION, ...b };
  return { ...body, bundleHash: sha256(JSON.stringify(body)) };
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`bundle: ${what} must be an object`);
  return v as Record<string, unknown>;
}
function list(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`bundle: ${what} must be an array`);
  return v;
}

function checkFiles(b: Record<string, unknown>): Record<string, string> {
  const sources = obj(b.sources, 'sources') as Record<string, string>;
  const files = list(b.files, 'files') as SourceFile[];
  if (files.length > MAX_BUNDLE_FILES || files.length !== Object.keys(sources).length) throw new Error('bundle: file list does not match sources');
  const hashes: Record<string, string> = {};
  for (const f of files) {
    if (!isSafeRelativePath(f.path) || typeof sources[f.path] !== 'string' || sha256(sources[f.path]) !== f.hash) throw new Error(`bundle: source hash mismatch for ${String(f.path)}`);
    hashes[f.path] = f.hash;
  }
  if (snapshotHashOf(hashes) !== b.snapshotHash) throw new Error('bundle: snapshot hash mismatch');
  return hashes;
}

function validSpan(s: CodeSymbol, hashes: Record<string, string>, sources: Record<string, string>): boolean {
  const span = s.span as Partial<CodeSymbol['span']> | undefined;
  if (!span?.file || hashes[span.file] !== s.fileHash) return false;
  const lines = sources[span.file].split('\n').length;
  return Number(span.startLine) >= 1 && Number(span.endLine) <= lines && Number(span.endLine) >= Number(span.startLine);
}

function checkSymbols(b: Record<string, unknown>, hashes: Record<string, string>, sources: Record<string, string>): Set<string> {
  const ids = new Set<string>();
  for (const s of list(b.symbols, 'symbols') as CodeSymbol[]) {
    if (typeof s.id !== 'string' || ids.has(s.id) || !validSpan(s, hashes, sources)) throw new Error(`bundle: invalid symbol ${String(s.id)}`);
    ids.add(s.id);
  }
  for (const e of list(b.edges, 'edges') as StaticEdge[]) {
    if (e.provenance !== 'static' || !ids.has(e.from) || !ids.has(e.to)) throw new Error('bundle: invalid static edge');
  }
  return ids;
}

const MAX_IMPORTED_EVENTS = 10_000;
const RUN_STATUSES = new Set(['ok', 'error', 'timeout']);

function checkRun(run: Run, snapshotHash: unknown, ids: Set<string>): void {
  const hashes = run.fileHashes as unknown;
  const validHashes = Boolean(hashes) && typeof hashes === 'object' && Object.values(hashes as object).every(h => typeof h === 'string');
  if (typeof run.id !== 'string' || run.snapshotHash !== snapshotHash || !ids.has(run.entrySymbol) || !RUN_STATUSES.has(run.status) || !validHashes) {
    throw new Error(`bundle: run ${String(run.id)} does not belong to this snapshot or is malformed`);
  }
}

/**
 * Structural validation only: `bundleHash` is an unkeyed checksum, so it detects edits and corruption, not a
 * forger who recomputes it. Imported runs are therefore stored as `imported` evidence, never as local runs.
 */
export function validateBundle(value: unknown): EvidenceBundle {
  const b = obj(value, 'bundle');
  if (b.kind !== 'mindmeld-bundle' || b.version !== SCHEMA_VERSION) throw new Error('bundle: unsupported kind or version');
  const { bundleHash, ...body } = b;
  if (sha256(JSON.stringify(body)) !== bundleHash) throw new Error('bundle: bundle hash mismatch (edited or forged)');
  const hashes = checkFiles(b);
  const ids = checkSymbols(b, hashes, b.sources as Record<string, string>);
  const events = obj(b.events, 'events');
  const cleaned: Record<string, TraceEvent[]> = {};
  for (const run of list(b.runs, 'runs') as Run[]) {
    checkRun(run, b.snapshotHash, ids);
    cleaned[run.id] = parseTrace({ events: events[run.id] ?? [] }, run.id, ids, MAX_IMPORTED_EVENTS).events;
  }
  return { ...(b as unknown as EvidenceBundle), events: cleaned };
}
