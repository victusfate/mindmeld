// Run panel: pick an allowlisted entry, edit validated JSON args, Run in the sandbox; the runs list shows
// status and stale badges. Run is disabled while the sandbox is unavailable.
import { useMemo, useState } from 'react';
import type { Entry, Run, Status } from '@mindmeld/client';
import { api } from '../../api.ts';
import type { ProjectData, Report } from '../../hooks.ts';
import { checkInputs, inputTemplate } from '../../lib/inputs.ts';
import { shortSymbol } from '../../lib/diff.ts';
import { duration, errorMessage } from '../../lib/format.ts';

interface Props { projectId: string; data: ProjectData; status: Status | null; onReplay: (runId: string, step: number) => void; onChanged: () => void; report: Report }

export function RunBadges({ run }: { run: Run }) {
  return (
    <>
      <span className={`badge badge-${run.status}`}>{run.status}</span>
      {run.stale && <span className="badge badge-stale" title={`Source changed since this run: ${(run.staleFiles ?? []).join(', ')}`}>stale</span>}
    </>
  );
}

function RunsList({ runs, onReplay }: { runs: Run[]; onReplay: Props['onReplay'] }) {
  if (!runs.length) return <p className="muted">No runs yet.</p>;
  return (
    <ul className="runs" data-testid="runs">
      {[...runs].reverse().map(r => (
        <li key={r.id}>
          <button type="button" className="run-row" onClick={() => onReplay(r.id, 0)}>
            <RunBadges run={r} />
            <span className="mono">{shortSymbol(r.entrySymbol)}</span>
            <span className="mono muted truncate">{r.inputs}</span>
            <span className="muted small">{duration(r.durationMs)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Per-entry argument drafts, starting from a `null`-per-parameter template. */
function useDraft(data: ProjectData, entry: Entry): [string, (v: string) => void] {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const params = useMemo(() => data.graph?.symbols.find(s => s.id === entry.symbolId)?.params ?? [], [data.graph, entry.symbolId]);
  return [drafts[entry.id] ?? inputTemplate(params), (v: string) => setDrafts(d => ({ ...d, [entry.id]: v }))];
}

const sandboxTitle = (status: Status | null): string =>
  status?.sandbox.available ? 'Run in the network-less sandbox' : `Sandbox unavailable: ${status?.sandbox.reason ?? 'checking'}`;

function RunForm({ projectId, data, status, onReplay, onChanged, report, entries }: Props & { entries: Entry[] }) {
  const [entryId, setEntryId] = useState('');
  const entry = entries.find(e => e.id === entryId) ?? entries[0];
  const [text, setText] = useDraft(data, entry);
  const [busy, setBusy] = useState(false);
  const check = checkInputs(text);
  const run = async (): Promise<void> => {
    if (!check.ok) return;
    setBusy(true);
    try {
      const result = await api.execute(projectId, entry.id, check.value);
      await data.reload();
      onReplay(result.run.id, 0);
    } catch (e) { report(`Run failed: ${errorMessage(e)}`); } finally { setBusy(false); onChanged(); }
  };
  return (
    <form onSubmit={e => { e.preventDefault(); void run(); }}>
      <label htmlFor="entry">Entry</label>
      <select id="entry" value={entry.id} onChange={e => setEntryId(e.target.value)}>
        {entries.map(e => <option key={e.id} value={e.id}>{e.symbolId}</option>)}
      </select>
      <label htmlFor="inputs">Arguments (JSON array)</label>
      <textarea id="inputs" className="mono" rows={6} spellCheck={false} value={text} onChange={e => setText(e.target.value)} aria-invalid={!check.ok} aria-describedby="inputs-msg" />
      <p id="inputs-msg" className={check.ok ? 'muted small' : 'error small'}>{check.ok ? `${check.value.length} argument(s)` : check.error}</p>
      <button type="submit" className="primary" disabled={status?.sandbox.available !== true || !check.ok || busy} data-testid="run-button"
        title={sandboxTitle(status)}>{busy ? 'Running…' : 'Run'}</button>
    </form>
  );
}

export function RunPanel(p: Props) {
  return (
    <div className="run-panel">
      <h2>Run in sandbox</h2>
      {p.data.entries.length ? <RunForm {...p} entries={p.data.entries} />
        : <p className="muted">No allowlisted entries. Open an exported function's source and choose <strong>Allowlist as entry</strong>.</p>}
      <h3>Runs</h3>
      <RunsList runs={p.data.runs} onReplay={p.onReplay} />
    </div>
  );
}
