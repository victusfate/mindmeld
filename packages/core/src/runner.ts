// Executes one allowlisted entry inside a sandbox connector and turns its output into evidence.
// No sandbox, no run: there is no host fallback. Everything returned is validated, bounded and redacted.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HARNESS_FILE, HARNESS_SOURCE } from './harness.ts';
import { instrumentProject, outputPath } from './instrument.ts';
import { bound, redactText } from './redact.ts';
import { newId } from './hash.ts';
import type { CodeSymbol, Run, SandboxIdentity, TraceEvent } from './schema.ts';

export interface SandboxSpec { workdir: string; command: string[]; timeoutMs: number; memoryMb: number }
export interface SandboxResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
export interface SandboxStatus { available: boolean; reason: string; runtime: string | null }
/** Implemented by @mindmeld/connectors. `run` must enforce no network, read-only source and resource bounds. */
export interface SandboxConnector {
  readonly name: string;
  readonly image: string;
  status(): Promise<SandboxStatus>;
  run(spec: SandboxSpec): Promise<SandboxResult>;
}

export interface RunRequest {
  projectId: string;
  snapshotId: string;
  snapshotHash: string;
  contents: Map<string, string>;
  fileHashes: Record<string, string>;
  symbols: CodeSymbol[];
  entry: CodeSymbol;
  inputs: unknown[];
  timeoutMs?: number;
  memoryMb?: number;
  maxEvents?: number;
  /** Where run workspaces are created. A containerised Studio talking to the host daemon needs a path that exists on both. */
  workRoot?: string;
}

const MAX_TEXT = 4000;
const MAX_STDOUT = 20_000;

export class SandboxUnavailableError extends Error {}
export class TraceRejectedError extends Error {}

function workspace(contents: Map<string, string>, root: string): string {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'mindmeld-run-'));
  for (const [path, text] of instrumentProject(contents)) {
    if (path === 'package.json' || path === HARNESS_FILE) continue;   // ours win: the emitted tree is always ESM
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, { mode: 0o444 });
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }), { mode: 0o444 });
  writeFileSync(join(dir, HARNESS_FILE), HARNESS_SOURCE, { mode: 0o444 });
  chmodSync(dir, 0o755);
  return dir;
}

const str = (v: unknown, max = MAX_TEXT): string => bound(redactText(typeof v === 'string' ? v : JSON.stringify(v ?? null)), max);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validParent = (p: unknown, i: number): boolean => p === null || (Number.isSafeInteger(p) && (p as number) >= 0 && (p as number) < i);

function validEvent(raw: Record<string, unknown>, i: number, symbols: Set<string>): boolean {
  return raw.seq === i && typeof raw.symbol === 'string' && symbols.has(raw.symbol) && validParent(raw.parent, i)
    && Number.isSafeInteger(raw.depth) && finite(raw.startMs) && finite(raw.durationMs) && raw.durationMs >= 0;
}

/** Strict host-side check: every event names a known symbol and a preceding parent, or the trace is rejected. */
export function parseTrace(raw: unknown, runId: string, symbols: Set<string>, maxEvents: number): { events: TraceEvent[]; meta: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TraceRejectedError('trace is not an object');
  const meta = raw as Record<string, unknown>;
  if (!Array.isArray(meta.events) || meta.events.length > maxEvents) throw new TraceRejectedError('trace events missing or over limit');
  const events = meta.events.map((item: unknown, i: number): TraceEvent => {
    const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    if (!validEvent(e, i, symbols)) throw new TraceRejectedError(`invalid trace event ${i}`);
    return {
      runId, seq: i, symbol: e.symbol as string, parent: e.parent as number | null, depth: e.depth as number,
      args: str(e.args), result: str(e.result), threw: e.threw === true, async: e.async === true,
      thisBefore: e.thisBefore == null ? null : str(e.thisBefore), thisAfter: e.thisAfter == null ? null : str(e.thisAfter),
      startMs: e.startMs as number, durationMs: e.durationMs as number,
    };
  });
  return { events, meta };
}

function sandboxIdentity(sandbox: SandboxConnector, timeoutMs: number, memoryMb: number): SandboxIdentity {
  return { connector: sandbox.name, image: sandbox.image, network: 'none', memoryMb, timeoutMs };
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MEMORY_MB = 256;
const DEFAULT_MAX_EVENTS = 5000;
const MARKER_BYTES = 12;
const MAX_RUNTIME_LABEL = 40;

interface Attempt { req: RunRequest; runId: string; marker: string; inputs: string; base: Run; maxEvents: number }

function checkRequest(req: RunRequest): void {
  if (!req.entry.exported || !['function', 'variable-function'].includes(req.entry.kind)) throw new Error('entry must be an exported function');
  if (!Array.isArray(req.inputs)) throw new Error('inputs must be a JSON array of arguments');
}

/** Turn raw sandbox output into a run record. No marker means the harness never finished: no events are claimed. */
function toEvidence(a: Attempt, result: SandboxResult): { run: Run; events: TraceEvent[] } {
  const at = result.stdout.lastIndexOf(a.marker);
  if (result.timedOut || at < 0) {
    const error = result.timedOut ? 'timed out' : `no trace emitted (exit ${String(result.exitCode)}): ${result.stderr}`;
    return { run: { ...a.base, status: result.timedOut ? 'timeout' : 'error', error: str(error), stdout: str(result.stdout, MAX_STDOUT) }, events: [] };
  }
  const symbols = new Set(a.req.symbols.map(s => s.id));
  const { events, meta } = parseTrace(JSON.parse(result.stdout.slice(at + a.marker.length)), a.runId, symbols, a.maxEvents);
  return { run: { ...a.base, status: meta.status === 'ok' ? 'ok' : 'error', output: str(meta.output), error: meta.error == null ? null : str(meta.error),
    stdout: str(result.stdout.slice(0, at), MAX_STDOUT), truncated: meta.truncated === true,
    runtimeVersion: typeof meta.runtime === 'string' ? bound(meta.runtime, MAX_RUNTIME_LABEL) : a.base.runtimeVersion }, events };
}

export async function executeRun(sandbox: SandboxConnector, req: RunRequest): Promise<{ run: Run; events: TraceEvent[] }> {
  checkRequest(req);
  const status = await sandbox.status();
  if (!status.available) throw new SandboxUnavailableError(`execution unavailable: ${status.reason}`);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMb = req.memoryMb ?? DEFAULT_MEMORY_MB;
  const maxEvents = req.maxEvents ?? DEFAULT_MAX_EVENTS;
  const runId = newId('run');
  const inputs = JSON.stringify(req.inputs);
  const base: Run = {
    id: runId, projectId: req.projectId, snapshotId: req.snapshotId, snapshotHash: req.snapshotHash, entrySymbol: req.entry.id,
    inputs: str(inputs), status: 'timeout', output: '', error: null, stdout: '', truncated: false, createdAt: new Date().toISOString(),
    durationMs: 0, sandbox: sandboxIdentity(sandbox, timeoutMs, memoryMb), runtimeVersion: status.runtime ?? 'unknown', fileHashes: req.fileHashes,
  };
  const attempt: Attempt = { req, runId, inputs, base, maxEvents, marker: `@@MINDMELD:${randomBytes(MARKER_BYTES).toString('hex')}@@` };
  const dir = workspace(req.contents, req.workRoot ?? tmpdir());
  const started = performance.now();
  try {
    const result = await sandbox.run({ workdir: dir, timeoutMs, memoryMb, command: ['node', `/app/${HARNESS_FILE}`,
      outputPath(req.entry.span.file), req.entry.name, Buffer.from(inputs).toString('base64'), attempt.marker, String(maxEvents)] });
    base.durationMs = performance.now() - started;
    return toEvidence(attempt, result);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
