// Citation grammar and resolution. `[S:<symbol id>]` cites a source span; `[E:<run id>#<seq>]` cites a
// recorded trace event. A citation is valid only if it resolves; stale evidence stays visible as stale.
import type { CodeSymbol, CitationRef, ResolvedCitation, Run, TraceEvent } from './schema.ts';

const CITATION = /\[(S|E):([^\]\s]+)\]/g;

export function extractCitations(text: string): CitationRef[] {
  const out: CitationRef[] = [];
  for (const m of text.matchAll(CITATION)) out.push({ kind: m[1] === 'S' ? 'symbol' : 'event', ref: m[2] });
  return out;
}

export interface CitationContext {
  symbols: Map<string, CodeSymbol>;
  runs: Map<string, Run>;
  events: (runId: string) => TraceEvent[];
}

const missing = (c: CitationRef, label: string): ResolvedCitation => ({ ...c, valid: false, freshness: 'missing', span: null, fileHash: null, label });

function resolveSymbol(c: CitationRef, ctx: CitationContext, pinnedHash?: string): ResolvedCitation {
  const s = ctx.symbols.get(c.ref);
  if (!s) return missing(c, `unknown symbol ${c.ref}`);
  const stale = pinnedHash !== undefined && pinnedHash !== s.fileHash;
  return { ...c, valid: true, freshness: stale ? 'stale' : 'fresh', span: s.span, fileHash: s.fileHash, label: `${s.name} (${s.span.file}:${s.span.startLine}-${s.span.endLine})` };
}

/** `pinnedHash` is the file hash recorded when the citation was made; a different current hash means stale. */
export function resolveCitation(c: CitationRef, ctx: CitationContext, pinnedHash?: string): ResolvedCitation {
  return c.kind === 'symbol' ? resolveSymbol(c, ctx, pinnedHash) : resolveEvent(c, ctx);
}

function resolveEvent(c: CitationRef, ctx: CitationContext): ResolvedCitation {
  const [runId, seqText] = c.ref.split('#');
  const run = ctx.runs.get(runId);
  const seq = Number(seqText);
  const event = run && Number.isSafeInteger(seq) ? ctx.events(runId)[seq] : undefined;
  if (!run || !event) return missing(c, `unknown event ${c.ref}`);
  const s = ctx.symbols.get(event.symbol);
  return { ...c, valid: true, freshness: run.stale ? 'stale' : 'fresh', span: s?.span ?? null, fileHash: run.fileHashes[event.symbol.split('#')[0]] ?? null,
    label: `run ${runId} event ${seq}: ${event.symbol}` };
}
