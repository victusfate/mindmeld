// Header: project picker, import (local path / https git URL), bundle import/export, status chips and usage chip.
import { useState, type FormEvent } from 'react';
import type { Project, Status, UsageSummary } from '@mindmeld/client';
import { api } from '../api.ts';
import { errorMessage } from '../lib/format.ts';
import { costLabel, usageTooltip } from '../lib/usage.ts';
import { toggleScheme } from '../theme.ts';
import type { Report } from '../hooks.ts';

interface Props {
  status: Status | null; projects: Project[]; project: Project | null; usage: UsageSummary | null;
  onChoose: (id: string) => void; onAdded: (p: Project) => Promise<void>; onUsage: () => void; report: Report;
}

function Chip({ label, ok, reason }: { label: string; ok: boolean | null; reason: string }) {
  const tone = ok === null ? 'unknown' : ok ? 'ok' : 'bad';
  return <span className={`chip chip-${tone}`} title={reason} data-testid={`chip-${label}`}><span className="dot" aria-hidden="true" />{label}: {ok === null ? 'checking' : ok ? 'ready' : 'unavailable'}</span>;
}

function StatusChips({ status }: { status: Status | null }) {
  if (!status) return <><Chip label="sandbox" ok={null} reason="" /><Chip label="model" ok={null} reason="" /></>;
  return (
    <>
      <Chip label="sandbox" ok={status.sandbox.available} reason={`${status.sandbox.name}: ${status.sandbox.reason}`} />
      <Chip label="model" ok={status.model.available} reason={`${status.model.name ?? 'none'}: ${status.model.reason}`} />
    </>
  );
}

function UsageChip({ usage, onUsage }: { usage: UsageSummary | null; onUsage: () => void }) {
  return (
    <button type="button" className="chip chip-usage" data-testid="usage-chip" onClick={onUsage} title={usage ? usageTooltip(usage) : 'Loading usage'}>
      cost {usage ? costLabel(usage.totals) : '…'}
    </button>
  );
}

function ImportForm({ onAdded, report, onDone }: { onAdded: Props['onAdded']; report: Report; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const value = ref.trim();
    if (!value) return;
    setBusy(true);
    try {
      const { project } = await api.addProject(/^https:\/\//.test(value) ? 'git' : 'local', value);
      await onAdded(project);
      setRef('');
      onDone();
    } catch (err) { report(`Import failed: ${errorMessage(err)}`); } finally { setBusy(false); }
  };
  return (
    <form className="import-form" onSubmit={e => void submit(e)}>
      <label htmlFor="import-ref">Repository</label>
      <input id="import-ref" value={ref} onChange={e => setRef(e.target.value)} placeholder="/path/to/repo or https://host/org/repo.git" autoFocus />
      <button type="submit" className="primary" disabled={busy || !ref.trim()}>{busy ? 'Importing…' : 'Import'}</button>
    </form>
  );
}

async function exportBundle(project: Project, report: Report): Promise<void> {
  try {
    const bundle = await api.exportBundle(project.id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.mindmeld.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { report(`Export failed: ${errorMessage(e)}`); }
}

async function importBundle(file: File, onAdded: Props['onAdded'], report: Report): Promise<void> {
  try { await onAdded(await api.importBundle(JSON.parse(await file.text()))); } catch (e) { report(`Bundle import failed: ${errorMessage(e)}`); }
}

export function Header(p: Props) {
  const [importing, setImporting] = useState(false);
  return (
    <header className="header">
      <div className="header-row">
        <span className="brand"><span className="brand-mark" aria-hidden="true">◆</span> Mind Meld Studio</span>
        <label className="sr-only" htmlFor="project">Project</label>
        <select id="project" value={p.project?.id ?? ''} onChange={e => p.onChoose(e.target.value)} disabled={!p.projects.length}>
          {!p.projects.length && <option value="">No projects</option>}
          {p.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button type="button" onClick={() => setImporting(v => !v)} aria-expanded={importing}>Import</button>
        <button type="button" disabled={!p.project} onClick={() => p.project && void exportBundle(p.project, p.report)}>Export bundle</button>
        <label className="button file-button">Import bundle
          <input type="file" accept="application/json,.json" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void importBundle(f, p.onAdded, p.report); e.target.value = ''; }} />
        </label>
        <span className="spacer" />
        <StatusChips status={p.status} />
        <UsageChip usage={p.usage} onUsage={p.onUsage} />
        <button type="button" className="ghost" onClick={() => toggleScheme()} title="Toggle light/dark">Theme</button>
      </div>
      {importing && <ImportForm onAdded={p.onAdded} report={p.report} onDone={() => setImporting(false)} />}
    </header>
  );
}
