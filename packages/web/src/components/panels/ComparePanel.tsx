// Compare two recorded runs: the aligned call paths side by side, the first divergence and calls only in A or B.
import { useEffect, useState } from 'react';
import type { Run, RunDiff, TraceEvent } from '@mindmeld/client';
import { api } from '../../api.ts';
import type { ProjectData, Report } from '../../hooks.ts';
import { CHANGE_LABEL, compareRows, shortSymbol } from '../../lib/diff.ts';
import { errorMessage, preview } from '../../lib/format.ts';

interface Props { data: ProjectData; report: Report; onSelect: (id: string) => void }
interface Loaded { diff: RunDiff; a: TraceEvent[]; b: TraceEvent[] }

function Pick({ label, runs, value, onChange }: { label: string; runs: Run[]; value: string; onChange: (v: string) => void }) {
  return (
    <label>{label}
      <select value={value} onChange={e => onChange(e.target.value)} data-testid={`compare-${label}`}>
        <option value="">choose…</option>
        {runs.map(r => <option key={r.id} value={r.id}>{r.id} · {r.status}{r.stale ? ' (stale)' : ''} · {preview(r.inputs)}</option>)}
      </select>
    </label>
  );
}

function useDiff(a: string, b: string, report: Report): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    setLoaded(null);
    if (!a || !b) return;
    Promise.all([api.diff(a, b), api.run(a), api.run(b)])
      .then(([diff, ra, rb]) => { if (live) setLoaded({ diff, a: ra.events, b: rb.events }); }, (e: unknown) => report(errorMessage(e)));
    return () => { live = false; };
  }, [a, b, report]);
  return loaded;
}

function Only({ label, ids, onSelect, testId }: { label: string; ids: string[]; onSelect: (id: string) => void; testId: string }) {
  return (
    <p data-testid={testId}><strong>{label}:</strong> {ids.length ? ids.map(id => <button key={id} type="button" className="link mono" onClick={() => onSelect(id)}>{shortSymbol(id)}</button>) : <span className="muted">none</span>}</p>
  );
}

function DiffView({ loaded, onSelect }: { loaded: Loaded; onSelect: (id: string) => void }) {
  const { diff } = loaded;
  const rows = compareRows(diff, loaded.a, loaded.b);
  return (
    <>
      {!diff.sameSnapshot && <p className="warn small">The runs used different source snapshots.</p>}
      <dl className="outputs">
        <dt>A ({diff.statusA})</dt><dd className="mono">{preview(diff.outputA)}</dd>
        <dt>B ({diff.statusB})</dt><dd className="mono">{preview(diff.outputB)}</dd>
      </dl>
      <p className="small">{diff.firstDivergence === null ? 'The observed paths are identical.' : `First divergence at row ${diff.firstDivergence + 1}.`}</p>
      <Only label="Only in A" ids={diff.onlyInA} onSelect={onSelect} testId="only-a" />
      <Only label="Only in B" ids={diff.onlyInB} onSelect={onSelect} testId="only-b" />
      <table className="diff">
        <thead><tr><th scope="col">Call</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Change</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.index} className={`change-${r.change}${r.first ? ' first' : ''}`}>
              <td className="mono">{shortSymbol(r.symbol)}</td>
              <td className="mono truncate">{r.a ? preview(r.a.result) : '—'}</td>
              <td className="mono truncate">{r.b ? preview(r.b.result) : '—'}</td>
              <td>{CHANGE_LABEL[r.change]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function ComparePanel({ data, report, onSelect }: Props) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const loaded = useDiff(a, b, report);
  const runs = [...data.runs].reverse();
  return (
    <div className="compare">
      <h2>Compare runs</h2>
      {runs.length < 2 ? <p className="muted">Record at least two runs to compare them.</p> : (
        <div className="pickers"><Pick label="A" runs={runs} value={a} onChange={setA} /><Pick label="B" runs={runs} value={b} onChange={setB} /></div>
      )}
      {loaded && <DiffView loaded={loaded} onSelect={onSelect} />}
    </div>
  );
}
