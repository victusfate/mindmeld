// Answer rendering helpers. Citations are `[S:<symbol id>]` (source span) or `[E:<run id>#<seq>]` (recorded event);
// each one becomes a link that resolves to its evidence, or is flagged when it does not resolve.
import type { Answer, ResolvedCitation } from '@mindmeld/client';

type AnswerSentence = Answer['sentences'][number];

export interface CiteRef { kind: 'symbol' | 'event'; ref: string }
export type Segment = { kind: 'text'; text: string } | { kind: 'cite'; cite: CiteRef; resolved: ResolvedCitation | null };

const CITATION = /\[(S|E):([^\]\s]+)\]/g;

export const citeKey = (c: CiteRef): string => `${c.kind}:${c.ref}`;

export function resolvedIndex(answer: Answer): Map<string, ResolvedCitation> {
  return new Map(answer.citations.map(c => [citeKey(c), c]));
}

/** Split a sentence into plain text and citation segments, attaching each citation's resolution. */
export function segments(text: string, index: Map<string, ResolvedCitation>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const at = m.index;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    const cite: CiteRef = { kind: m[1] === 'S' ? 'symbol' : 'event', ref: m[2] };
    out.push({ kind: 'cite', cite, resolved: index.get(citeKey(cite)) ?? null });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** `run_abc#3` → run id and event sequence number, or null when malformed. */
export function parseEventRef(ref: string): { runId: string; seq: number } | null {
  const [runId, seqText] = ref.split('#');
  const seq = Number(seqText);
  return runId && Number.isSafeInteger(seq) && seq >= 0 ? { runId, seq } : null;
}

export interface AnswerView {
  abstained: boolean;
  supported: AnswerSentence[];
  unsupported: AnswerSentence[];
  invalidCitations: ResolvedCitation[];
  staleCitations: ResolvedCitation[];
}

/** What the UI shows: supported sentences up front, unsupported ones behind a reveal, citation problems listed. */
export function answerView(answer: Answer): AnswerView {
  return {
    abstained: answer.abstained,
    supported: answer.sentences.filter(s => s.supported),
    unsupported: answer.sentences.filter(s => !s.supported),
    invalidCitations: answer.citations.filter(c => !c.valid),
    staleCitations: answer.citations.filter(c => c.valid && c.freshness === 'stale'),
  };
}

export function citationTone(c: ResolvedCitation | null): 'fresh' | 'stale' | 'invalid' {
  if (!c?.valid) return 'invalid';
  return c.freshness === 'stale' ? 'stale' : 'fresh';
}
