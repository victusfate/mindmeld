// Pure shaping of tree-view nodes: symbols grouped by file, runs with their stale state, and a run's recorded
// events as a call tree (each event's `parent` is the seq of the event that called it).
import type { CodeSymbol, Run, TraceEvent } from '@mindmeld/client';
import { shortName, staticCallersText, type SymbolEvidence } from './evidence.ts';

export interface FileGroup { file: string; symbols: CodeSymbol[] }

export function groupByFile(symbols: CodeSymbol[]): FileGroup[] {
  const groups = new Map<string, CodeSymbol[]>();
  for (const s of symbols) groups.set(s.span.file, [...(groups.get(s.span.file) ?? []), s]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([file, list]) => ({ file, symbols: list.sort((a, b) => a.span.startLine - b.span.startLine) }));
}

export function symbolDescription(s: CodeSymbol, e: SymbolEvidence): string {
  const observed = e.observedCalls ? `observed ${e.observedCalls}×` : 'not observed';
  return [s.exported ? 'exported' : '', staticCallersText(e.staticCallers), observed].filter(Boolean).join(' · ');
}

export const runLabel = (run: Run): string => `${shortName(run.entrySymbol)} — ${run.status}`;

export function runDescription(run: Run): string {
  const when = run.createdAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  return run.stale ? `STALE · ${when}` : when;
}

export function runTooltip(run: Run): string {
  const lines = [`${run.entrySymbol} (${run.status}, ${run.durationMs} ms)`, `inputs: ${run.inputs}`, `sandbox: ${run.sandbox.connector}`];
  if (run.error) lines.push(`error: ${run.error}`);
  if (run.stale) lines.push(`stale — source changed since this run: ${(run.staleFiles ?? []).join(', ')}`);
  return lines.join('\n');
}

export const childEvents = (events: TraceEvent[], parent: number | null): TraceEvent[] => events.filter(e => e.parent === parent);

const MAX_VALUE_CHARS = 60;
const clip = (text: string): string => (text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text);

export function eventLabel(e: TraceEvent): string {
  return `${shortName(e.symbol)}(${clip(e.args.replace(/^\[|\]$/g, ''))})`;
}

export function eventDescription(e: TraceEvent): string {
  return `${e.threw ? 'threw' : '→'} ${clip(e.result)} · observed`;
}
