// Compare view rows: each aligned diff row becomes a side-by-side pair with a change marker.
import type { RunDiff, TraceEvent } from '@mindmeld/client';

export type RowChange = 'same' | 'values' | 'only-a' | 'only-b';
export interface CompareRow {
  index: number;
  symbol: string;
  a: TraceEvent | null;
  b: TraceEvent | null;
  change: RowChange;
  first: boolean;
}

function change(a: number | null, b: number | null, sameValues: boolean): RowChange {
  if (b === null) return 'only-a';
  if (a === null) return 'only-b';
  return sameValues ? 'same' : 'values';
}

export function compareRows(diff: RunDiff, eventsA: TraceEvent[], eventsB: TraceEvent[]): CompareRow[] {
  return diff.rows.map((r, index) => ({
    index, symbol: r.symbol,
    a: r.a === null ? null : eventsA[r.a] ?? null,
    b: r.b === null ? null : eventsB[r.b] ?? null,
    change: change(r.a, r.b, r.sameValues),
    first: diff.firstDivergence === index,
  }));
}

export const CHANGE_LABEL: Record<RowChange, string> = { same: 'same', values: 'values differ', 'only-a': 'only in A', 'only-b': 'only in B' };

/** `src/combat.ts#legacyCritical` → `legacyCritical`, the readable part of a symbol id. */
export const shortSymbol = (id: string): string => id.slice(id.indexOf('#') + 1) || id;
