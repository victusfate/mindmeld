// Inspector: tabbed side panel (source, run, replay, compare, ask, usage). Arrow keys move between tabs.
import type { KeyboardEvent } from 'react';
import type { RunResult, Status, UsageSummary } from '@mindmeld/client';
import type { ProjectData, Report } from '../hooks.ts';
import { SourcePanel } from './panels/SourcePanel.tsx';
import { RunPanel } from './panels/RunPanel.tsx';
import { ReplayPanel } from './panels/ReplayPanel.tsx';
import { ComparePanel } from './panels/ComparePanel.tsx';
import { AskPanel } from './panels/AskPanel.tsx';
import { UsagePanel } from './panels/UsagePanel.tsx';

export const TABS = ['source', 'run', 'replay', 'compare', 'ask', 'usage'] as const;
export type Tab = typeof TABS[number];

export interface InspectorProps {
  tab: Tab; onTab: (t: Tab) => void; projectId: string | null; data: ProjectData; status: Status | null;
  selected: string | null; onSelect: (id: string) => void;
  replayRun: RunResult | null; step: number; onReplay: (runId: string, step: number) => void;
  usage: UsageSummary | null; onChanged: () => void; report: Report;
}

function TabList({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const onKey = (e: KeyboardEvent): void => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    const next = TABS[(TABS.indexOf(tab) + delta + TABS.length) % TABS.length];
    onTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label="Inspector" onKeyDown={onKey}>
      {TABS.map(t => (
        <button key={t} id={`tab-${t}`} type="button" role="tab" aria-selected={t === tab} aria-controls="inspector-panel" tabIndex={t === tab ? 0 : -1}
          onClick={() => onTab(t)}>{t}</button>
      ))}
    </div>
  );
}

function Panel(p: InspectorProps & { projectId: string }) {
  switch (p.tab) {
    case 'source': return <SourcePanel projectId={p.projectId} data={p.data} selected={p.selected} onSelect={p.onSelect} report={p.report} />;
    case 'run': return <RunPanel projectId={p.projectId} data={p.data} status={p.status} onReplay={p.onReplay} onChanged={p.onChanged} report={p.report} />;
    case 'replay': return <ReplayPanel data={p.data} result={p.replayRun} step={p.step} onReplay={p.onReplay} onSelect={p.onSelect} />;
    case 'compare': return <ComparePanel data={p.data} report={p.report} onSelect={p.onSelect} />;
    case 'ask': return <AskPanel projectId={p.projectId} status={p.status} onSelect={p.onSelect} onReplay={p.onReplay} onChanged={p.onChanged} report={p.report} />;
    case 'usage': return <UsagePanel usage={p.usage} />;
  }
}

export function Inspector(p: InspectorProps) {
  return (
    <section className="inspector" aria-label="Inspector">
      <TabList tab={p.tab} onTab={p.onTab} />
      <div id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${p.tab}`} className="panel">
        {p.projectId || p.tab === 'usage' ? <Panel {...p} projectId={p.projectId ?? ''} /> : <p className="muted">Import a project to begin.</p>}
      </div>
    </section>
  );
}
