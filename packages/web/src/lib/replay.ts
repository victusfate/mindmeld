// Replay helpers: the call stack at a step and the observed path walked so far, both derived from parents.
import type { TraceEvent } from '@mindmeld/client';
import { edgeKey } from './edges.ts';

/** Outermost-first chain of events from the root call down to `step`. */
export function callStack(events: TraceEvent[], step: number): TraceEvent[] {
  const stack: TraceEvent[] = [];
  const seen = new Set<number>();
  let cur: TraceEvent | undefined = events[step];
  while (cur && !seen.has(cur.seq)) {
    seen.add(cur.seq);
    stack.unshift(cur);
    cur = cur.parent === null ? undefined : events[cur.parent];
  }
  return stack;
}

/** `from→to` keys for every call recorded up to and including `step`. */
export function pathUpTo(events: TraceEvent[], step: number): Set<string> {
  const keys = new Set<string>();
  for (const e of events.slice(0, step + 1)) {
    const parent = e.parent === null ? undefined : events[e.parent];
    if (parent) keys.add(edgeKey(parent.symbol, e.symbol));
  }
  return keys;
}

export const clampStep = (step: number, count: number): number => Math.min(Math.max(step, 0), Math.max(count - 1, 0));
