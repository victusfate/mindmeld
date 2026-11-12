// Per-symbol evidence summaries for CodeLens, tree descriptions and the callers picker. Static edges are
// *possible* calls found by the indexer; observed counts come only from fresh (non-stale) recorded runs.
import type { CodeSymbol, Graph, ObservedEdge, Run, StaticEdge } from '@mindmeld/client';

export type GraphEvidence = Pick<Graph, 'symbols' | 'staticEdges' | 'observedEdges'>;

export interface SymbolEvidence {
  /** Observed calls into the symbol in fresh runs, including runs that started at it. */
  observedCalls: number;
  observedRuns: number;
  staticCallers: number;
}

export interface CallerGroups { observed: ObservedEdge[]; staticOnly: StaticEdge[] }

const callEdgesTo = (graph: GraphEvidence, id: string): StaticEdge[] => graph.staticEdges.filter(e => e.kind === 'call' && e.to === id);

export function evidenceFor(graph: GraphEvidence, runs: Run[], id: string): SymbolEvidence {
  const runIds = new Set<string>();
  let observedCalls = 0;
  for (const edge of graph.observedEdges.filter(e => e.to === id)) {
    observedCalls += edge.count;
    for (const r of edge.runIds) runIds.add(r);
  }
  for (const run of runs.filter(r => !r.stale && r.entrySymbol === id)) {
    observedCalls++;
    runIds.add(run.id);
  }
  const staticCallers = new Set(callEdgesTo(graph, id).map(e => e.from)).size;
  return { observedCalls, observedRuns: runIds.size, staticCallers };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function staticCallersText(n: number): string {
  return n === 0 ? 'no static callers' : `${plural(n, 'static caller')} (possible)`;
}

export function lensTitle(e: SymbolEvidence): string {
  const observed = e.observedCalls === 0 ? 'no observed calls (static only)' : `observed ${e.observedCalls}× in ${plural(e.observedRuns, 'fresh run')}`;
  return `${observed} · ${staticCallersText(e.staticCallers)}`;
}

export const STALE_LENS_TITLE = 'index stale — refresh';

/** Callers split by provenance: observed callers first; static edges whose caller was never observed after. */
export function callerGroups(graph: GraphEvidence, id: string): CallerGroups {
  const observed = graph.observedEdges.filter(e => e.to === id).sort((a, b) => b.count - a.count);
  const seen = new Set(observed.map(e => e.from));
  const staticOnly = callEdgesTo(graph, id).filter(e => !seen.has(e.from));
  return { observed, staticOnly };
}

/** The innermost indexed symbol in `file` whose span contains the 1-based `line`. */
export function symbolAt(symbols: CodeSymbol[], file: string, line: number): CodeSymbol | undefined {
  const containing = symbols.filter(s => s.span.file === file && s.span.startLine <= line && line <= s.span.endLine);
  return containing.sort((a, b) => (a.span.endLine - a.span.startLine) - (b.span.endLine - b.span.startLine))[0];
}

export const canAllowlist = (s: CodeSymbol): boolean => s.exported && (s.kind === 'function' || s.kind === 'variable-function');

export const shortName = (symbolId: string): string => symbolId.slice(symbolId.indexOf('#') + 1);
