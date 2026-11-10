// Edge classification for the map. Static edges are *possible* calls found by parsing; observed edges come
// only from recorded, non-stale runs. The two never share a style: a static edge is never drawn as observed.
import type { ObservedEdge, StaticEdge } from '@mindmeld/client';

export type EdgeMode = 'both' | 'static' | 'observed';

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  provenance: 'static' | 'observed';
  /** `static` + resolution (e.g. `static-name-match`) or `observed`, plus `on-path` while replaying. */
  className: string;
  label: string;
  animated: boolean;
  /** Static edges curve; observed edges take right-angled routes so a pair drawn both ways stays distinct. */
  type: 'default' | 'smoothstep';
}

export interface EdgeInputs {
  staticEdges: StaticEdge[];
  observedEdges: ObservedEdge[];
  mode: EdgeMode;
  visible: Set<string>;
  /** `from→to` keys walked by the replay so far. */
  path: Set<string>;
}

export const edgeKey = (from: string, to: string): string => `${from}→${to}`;

export function staticEdge(e: StaticEdge): MapEdge {
  return {
    id: `s:${edgeKey(e.from, e.to)}:${e.kind}`, source: e.from, target: e.to, provenance: 'static',
    className: `edge-static static-${e.resolution}`, label: e.resolution, animated: false, type: 'default',
  };
}

export function observedEdge(e: ObservedEdge, onPath: boolean): MapEdge {
  return {
    id: `o:${edgeKey(e.from, e.to)}`, source: e.from, target: e.to, provenance: 'observed',
    className: onPath ? 'edge-observed on-path' : 'edge-observed', label: `×${e.count}`, animated: onPath, type: 'smoothstep',
  };
}

/** Edges to draw for the current filters. Call edges only: import edges link files, not symbols. */
export function mapEdges(i: EdgeInputs): MapEdge[] {
  const shown = (from: string, to: string): boolean => i.visible.has(from) && i.visible.has(to);
  const out: MapEdge[] = [];
  if (i.mode !== 'observed') {
    const seen = new Set<string>();
    for (const e of i.staticEdges) {
      const key = edgeKey(e.from, e.to);
      if (e.kind !== 'call' || seen.has(key) || !shown(e.from, e.to)) continue;
      seen.add(key);
      out.push(staticEdge(e));
    }
  }
  if (i.mode !== 'static') {
    for (const e of i.observedEdges) if (shown(e.from, e.to)) out.push(observedEdge(e, i.path.has(edgeKey(e.from, e.to))));
  }
  return out;
}
