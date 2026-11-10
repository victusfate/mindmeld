// Source pane: the selected symbol's file with line numbers, its span highlighted, the file hash, static
// callers/callees, and "Allowlist as entry" for exported functions.
import { useEffect, useRef, useState } from 'react';
import type { CodeSymbol, SourceFileContent } from '@mindmeld/client';
import { api } from '../../api.ts';
import type { ProjectData, Report } from '../../hooks.ts';
import { errorMessage, shortHash } from '../../lib/format.ts';
import { shortSymbol } from '../../lib/diff.ts';

interface Props { projectId: string; data: ProjectData; selected: string | null; onSelect: (id: string) => void; report: Report }

const RUNNABLE = new Set(['function', 'variable-function']);

function useSource(projectId: string, file: string | null, report: Report): SourceFileContent | null {
  const [src, setSrc] = useState<SourceFileContent | null>(null);
  useEffect(() => {
    let live = true;
    if (!file) { setSrc(null); return; }
    api.source(projectId, file).then(s => { if (live) setSrc(s); }, (e: unknown) => report(errorMessage(e)));
    return () => { live = false; };
  }, [projectId, file, report]);
  return src?.path === file ? src : null;
}

function Allowlist({ projectId, symbol, data, report }: { projectId: string; symbol: CodeSymbol; data: ProjectData; report: Report }) {
  const [busy, setBusy] = useState(false);
  if (!symbol.exported || !RUNNABLE.has(symbol.kind)) return <span className="muted small">Only exported functions can be allowlisted.</span>;
  if (data.entries.some(e => e.symbolId === symbol.id)) return <span className="badge badge-ok">allowlisted entry</span>;
  const add = async (): Promise<void> => {
    setBusy(true);
    try { await api.addEntry(projectId, symbol.id); await data.reload(); } catch (e) { report(errorMessage(e)); } finally { setBusy(false); }
  };
  return <button type="button" className="primary" disabled={busy} onClick={() => void add()}>Allowlist as entry</button>;
}

function Relations({ data, symbol, onSelect }: { data: ProjectData; symbol: CodeSymbol; onSelect: (id: string) => void }) {
  const edges = data.graph?.staticEdges.filter(e => e.kind === 'call') ?? [];
  const callers = [...new Set(edges.filter(e => e.to === symbol.id).map(e => e.from))];
  const callees = [...new Set(edges.filter(e => e.from === symbol.id).map(e => e.to))];
  const list = (ids: string[]) => ids.length ? ids.map(id => <button key={id} type="button" className="link" onClick={() => onSelect(id)}>{shortSymbol(id)}</button>) : <span className="muted">none</span>;
  return (
    <dl className="relations">
      <dt>Static callers</dt><dd>{list(callers)}</dd>
      <dt>Static callees</dt><dd>{list(callees)}</dd>
    </dl>
  );
}

function Code({ src, symbol }: { src: SourceFileContent; symbol: CodeSymbol }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => { ref.current?.querySelector('.hl')?.scrollIntoView({ block: 'center' }); }, [symbol.id, src.path]);
  const lines = src.content.split('\n');
  const inSpan = (n: number): boolean => n >= symbol.span.startLine && n <= symbol.span.endLine;
  return (
    <ol className="code" ref={ref} aria-label={`${src.path} source`} tabIndex={0}>
      {lines.map((text, i) => <li key={i} className={inSpan(i + 1) ? 'hl' : undefined}><code>{text || ' '}</code></li>)}
    </ol>
  );
}

export function SourcePanel({ projectId, data, selected, onSelect, report }: Props) {
  const symbol = data.graph?.symbols.find(s => s.id === selected) ?? null;
  const src = useSource(projectId, symbol?.span.file ?? null, report);
  if (!symbol) return <p className="muted">Select a symbol on the map (click, or Tab and Enter) to read its source.</p>;
  return (
    <div className="source">
      <div className="panel-head">
        <h2>{symbol.name} <span className="muted small">{symbol.kind}{symbol.async ? ' · async' : ''}</span></h2>
        <Allowlist projectId={projectId} symbol={symbol} data={data} report={report} />
      </div>
      <p className="meta">
        <span className="mono">{symbol.span.file}:{symbol.span.startLine}-{symbol.span.endLine}</span>
        {src && <span className="mono" title={src.hash}>hash {shortHash(src.hash)}</span>}
      </p>
      <Relations data={data} symbol={symbol} onSelect={onSelect} />
      {src ? <Code src={src} symbol={symbol} /> : <p className="muted">Loading source…</p>}
    </div>
  );
}
