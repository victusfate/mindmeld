// Source-linked map: symbols laid out callers → callees. Static (possible) edges are dashed grey, observed
// (recorded, non-stale) edges are solid accent; the legend says so and the filters never blur the two.
import { useCallback, useMemo, useState } from 'react';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type NodeChange } from '@xyflow/react';
import type { Entry, Graph } from '@mindmeld/client';
import { mapEdges, type EdgeMode, type MapEdge } from '../../lib/edges.ts';
import { fileSlots, initialFile, layoutSymbols } from '../../lib/layout.ts';
import { SymbolNode, type SymbolNodeType } from './SymbolNode.tsx';
import { Legend } from './Legend.tsx';

const FILE_SLOTS = 8;
const MIN_ZOOM = 0.2;
const GRID_GAP = 24;
const NODE_TYPES = { symbol: SymbolNode };

interface Props {
  graph: Graph; entries: Entry[]; selected: string | null; current: string | null; path: Set<string>;
  onSelect: (id: string) => void;
}

function toFlowEdge(e: MapEdge): Edge {
  const label = e.provenance === 'observed' || !['local', 'import'].includes(e.label) ? e.label : undefined;
  return { id: e.id, source: e.source, target: e.target, className: e.className, label, animated: e.animated, type: e.type,
    markerEnd: { type: MarkerType.ArrowClosed }, focusable: false, data: { provenance: e.provenance } };
}

type Size = { width: number; height: number };

/**
 * React Flow 12 hides a node until it has measured dimensions. Nodes are rebuilt on every render (replay steps,
 * new runs), so the last measurement is kept here and handed back; otherwise a re-render without a resize could
 * leave the whole map hidden (seen as an intermittent empty map right after a run).
 */
function useMeasured(): [Map<string, Size>, (changes: NodeChange[]) => void] {
  const [sizes, setSizes] = useState<Map<string, Size>>(() => new Map());
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const measured = changes.filter(c => c.type === 'dimensions' && c.dimensions);
    if (!measured.length) return;
    setSizes(prev => {
      const next = new Map(prev);
      for (const c of measured) if (c.type === 'dimensions' && c.dimensions) next.set(c.id, c.dimensions);
      return next;
    });
  }, []);
  return [sizes, onNodesChange];
}

const matches = (q: string, name: string, id: string): boolean => !q || name.toLowerCase().includes(q) || id.toLowerCase().includes(q);

export function MapView({ graph, entries, selected, current, path, onSelect }: Props) {
  const [mode, setMode] = useState<EdgeMode>('both');
  const files = useMemo(() => [...new Set(graph.symbols.map(s => s.span.file))].sort(), [graph]);
  const [file, setFile] = useState(() => initialFile(files, graph.symbols.length));
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const [sizes, onNodesChange] = useMeasured();
  const positions = useMemo(() => layoutSymbols(graph.symbols, [...graph.staticEdges.filter(e => e.kind === 'call'), ...graph.observedEdges]), [graph]);
  const slots = useMemo(() => fileSlots(graph.symbols, FILE_SLOTS), [graph]);
  const visibleSymbols = useMemo(() => graph.symbols.filter(s => !file || s.span.file === file), [graph, file]);
  const visible = useMemo(() => new Set(visibleSymbols.map(s => s.id)), [visibleSymbols]);
  const entryIds = useMemo(() => new Set(entries.map(e => e.symbolId)), [entries]);
  const onPathNodes = useMemo(() => new Set([...path].flatMap(k => k.split('→'))), [path]);

  const nodes: SymbolNodeType[] = visibleSymbols.map(s => ({
    id: s.id, type: 'symbol', position: positions.get(s.id) ?? { x: 0, y: 0 }, focusable: false, draggable: false, measured: sizes.get(s.id),
    data: { symbol: s, slot: slots.get(s.span.file) ?? 0, entry: entryIds.has(s.id), selected: s.id === selected, current: s.id === current,
      onPath: onPathNodes.has(s.id), dimmed: !matches(q, s.name, s.id), onSelect },
  }));
  const edges = mapEdges({ staticEdges: graph.staticEdges, observedEdges: graph.observedEdges, mode, visible, path }).map(toFlowEdge);
  const firstMatch = q ? visibleSymbols.find(s => matches(q, s.name, s.id)) : undefined;

  return (
    <div className="map">
      <div className="map-toolbar" role="toolbar" aria-label="Map filters">
        <label>Edges
          <select value={mode} onChange={e => setMode(e.target.value as EdgeMode)} data-testid="edge-mode">
            <option value="both">static + observed</option><option value="static">static only</option><option value="observed">observed only</option>
          </select>
        </label>
        <label>File
          <select value={file} onChange={e => setFile(e.target.value)}>
            <option value="">all files ({graph.symbols.length} symbols)</option>{files.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <input type="search" placeholder="Search symbols (Enter opens)" aria-label="Search symbols" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && firstMatch) onSelect(firstMatch.id); }} />
      </div>
      <div className="map-canvas">
        {/* Keyed by file too: fitView only runs on mount, and a file's symbols can lie outside the last view. */}
        <ReactFlow key={`${graph.project.id}:${file}`} nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={NODE_TYPES} fitView minZoom={MIN_ZOOM}
          onlyRenderVisibleElements
          nodesConnectable={false} edgesFocusable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
          <Background gap={GRID_GAP} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <Legend staleRuns={graph.staleRuns} observed={graph.observedEdges.length} />
      </div>
    </div>
  );
}
