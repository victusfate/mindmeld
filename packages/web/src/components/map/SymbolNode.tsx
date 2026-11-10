// One symbol on the map. The whole card is a button, so keyboard users can Tab to a symbol and open its source.
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CodeSymbol } from '@mindmeld/client';

export interface SymbolData extends Record<string, unknown> {
  symbol: CodeSymbol;
  slot: number;
  entry: boolean;
  selected: boolean;
  current: boolean;
  onPath: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}
export type SymbolNodeType = Node<SymbolData, 'symbol'>;

function classes(d: SymbolData): string {
  return ['symbol-node', `file-${d.slot}`, d.selected && 'is-selected', d.current && 'is-current', d.onPath && 'is-on-path', d.dimmed && 'is-dimmed']
    .filter(Boolean).join(' ');
}

export function SymbolNode({ data }: NodeProps<SymbolNodeType>) {
  const s = data.symbol;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button type="button" className={classes(data)} onClick={() => data.onSelect(s.id)} data-symbol={s.id}
        aria-label={`${s.name}, ${s.kind} in ${s.span.file}${data.entry ? ', allowlisted entry' : ''}`} aria-pressed={data.selected}>
        <span className="symbol-name">{s.name}</span>
        <span className="symbol-meta">
          <span className="kind">{s.kind}</span>
          {s.exported && <span className="tag">export</span>}
          {data.entry && <span className="tag tag-entry">entry</span>}
        </span>
        <span className="symbol-file">{s.span.file}:{s.span.startLine}</span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}
