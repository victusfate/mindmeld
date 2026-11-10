// Studio shell: header, availability banner, the map and the inspector tabs. App owns selection state only;
// panels fetch through the typed client.
import { useCallback, useMemo, useState } from 'react';
import type { Project } from '@mindmeld/client';
import { useProjectData, useProjects, useRun, useStatus, useUsage } from '../hooks.ts';
import { clampStep, pathUpTo } from '../lib/replay.ts';
import { Header } from './Header.tsx';
import { Banner, Notice } from './Banner.tsx';
import { MapView } from './map/MapView.tsx';
import { Inspector, type Tab } from './Inspector.tsx';
import { EmptyState } from './EmptyState.tsx';

interface ReplayTarget { runId: string; step: number }

/** Replay selection plus what the map highlights: the walked path and the current symbol (only on the Replay tab). */
function useReplay(tab: Tab, report: (m: string) => void) {
  const [replay, setReplay] = useState<ReplayTarget | null>(null);
  const replayRun = useRun(replay?.runId ?? null, report);
  const events = useMemo(() => replayRun?.events ?? [], [replayRun]);
  const step = clampStep(replay?.step ?? 0, events.length);
  const replaying = tab === 'replay' && events.length > 0;
  const path = useMemo(() => (replaying ? pathUpTo(events, step) : new Set<string>()), [replaying, events, step]);
  const current = replaying ? events[step]?.symbol ?? null : null;
  return { replayRun, step, path, current, setReplay };
}

export function App() {
  const [notice, setNotice] = useState<string | null>(null);
  const report = useCallback((m: string) => setNotice(m), []);
  const [tick, setTick] = useState(0);
  const changed = useCallback(() => setTick(t => t + 1), []);
  const status = useStatus(report, tick);
  const usage = useUsage(null, tick, report);
  const { projects, reload: reloadProjects } = useProjects(report);
  const [chosen, setChosen] = useState<string | null>(null);
  const projectId = chosen ?? projects.at(-1)?.id ?? null;
  const data = useProjectData(projectId, report);
  const [tab, setTab] = useState<Tab>('source');
  const [selected, setSelected] = useState<string | null>(null);
  const { replayRun, step, path, current, setReplay } = useReplay(tab, report);

  const selectSymbol = useCallback((id: string) => { setSelected(id); setTab('source'); }, []);
  const openEvent = useCallback((runId: string, step: number) => { setReplay({ runId, step }); setTab('replay'); }, []);
  const chooseProject = useCallback((id: string) => { setChosen(id); setSelected(null); setReplay(null); }, []);
  const added = useCallback(async (p: Project) => { await reloadProjects(); chooseProject(p.id); changed(); }, [reloadProjects, chooseProject, changed]);

  const project = projects.find(p => p.id === projectId) ?? null;

  return (
    <div className="app">
      <Header status={status} projects={projects} project={project} usage={usage} onChoose={chooseProject} onAdded={added}
        onUsage={() => setTab('usage')} report={report} />
      <Banner status={status} />
      <main className="workspace">
        <section className="map-pane" aria-label="Architecture map">
          {data.graph ? (
            <MapView graph={data.graph} entries={data.entries} selected={selected} current={current}
              path={path} onSelect={selectSymbol} />
          ) : <EmptyState hasProjects={projects.length > 0} />}
        </section>
        <Inspector tab={tab} onTab={setTab} projectId={projectId} data={data} status={status} selected={selected} onSelect={selectSymbol}
          replayRun={replayRun} step={step} onReplay={openEvent} usage={usage} onChanged={changed} report={report} />
      </main>
      <Notice message={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}
