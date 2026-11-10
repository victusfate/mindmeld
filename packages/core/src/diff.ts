// Compare two recorded runs: align their observed call paths (LCS on symbol ids) and report where they diverge.
import type { Run, TraceEvent } from './schema.ts';

export interface DiffRow { symbol: string; a: number | null; b: number | null; sameValues: boolean }
export interface RunDiff {
  a: string; b: string;
  sameSnapshot: boolean;
  outputA: string; outputB: string;
  statusA: string; statusB: string;
  rows: DiffRow[];
  firstDivergence: number | null;
  onlyInA: string[]; onlyInB: string[];
}

function lcs(a: string[], b: string[]): [number, number][] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function alignedRows(ea: TraceEvent[], eb: TraceEvent[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...lcs(ea.map(e => e.symbol), eb.map(e => e.symbol)), [ea.length, eb.length] as [number, number]]) {
    for (; i < pi; i++) rows.push({ symbol: ea[i].symbol, a: i, b: null, sameValues: false });
    for (; j < pj; j++) rows.push({ symbol: eb[j].symbol, a: null, b: j, sameValues: false });
    if (pi < ea.length && pj < eb.length) {
      rows.push({ symbol: ea[pi].symbol, a: pi, b: pj, sameValues: ea[pi].args === eb[pj].args && ea[pi].result === eb[pj].result && ea[pi].threw === eb[pj].threw });
      i = pi + 1; j = pj + 1;
    }
  }
  return rows;
}

export function diffRuns(a: Run, ea: TraceEvent[], b: Run, eb: TraceEvent[]): RunDiff {
  const rows = alignedRows(ea, eb);
  const first = rows.findIndex(r => r.a === null || r.b === null || !r.sameValues);
  const setA = new Set(ea.map(e => e.symbol));
  const setB = new Set(eb.map(e => e.symbol));
  return {
    a: a.id, b: b.id, sameSnapshot: a.snapshotHash === b.snapshotHash,
    outputA: a.output, outputB: b.output, statusA: a.status, statusB: b.status, rows,
    firstDivergence: first < 0 ? null : first,
    onlyInA: [...setA].filter(s => !setB.has(s)), onlyInB: [...setB].filter(s => !setA.has(s)),
  };
}
