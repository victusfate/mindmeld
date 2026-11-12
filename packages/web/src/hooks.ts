// Data hooks: everything the panels read comes from the Studio API through the typed client.
import { useCallback, useEffect, useState } from 'react';
import type { Entry, Graph, Project, Run, RunResult, Status, UsageSummary } from '@mindmeld/client';
import { api } from './api.ts';
import { errorMessage } from './lib/format.ts';

export type Report = (message: string) => void;

/** Sandbox and model availability; `tick` changes to re-check (e.g. after a failed run). */
export function useStatus(report: Report, tick: number): Status | null {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    api.status().then(s => { if (live) setStatus(s); }, (e: unknown) => report(errorMessage(e)));
    return () => { live = false; };
  }, [report, tick]);
  return status;
}

export function useProjects(report: Report): { projects: Project[]; reload: () => Promise<Project[]> } {
  const [projects, setProjects] = useState<Project[]>([]);
  const reload = useCallback(async () => {
    try {
      const list = await api.projects();
      setProjects(list);
      return list;
    } catch (e) { report(errorMessage(e)); return []; }
  }, [report]);
  useEffect(() => { void reload(); }, [reload]);
  return { projects, reload };
}

export interface ProjectData { graph: Graph | null; entries: Entry[]; runs: Run[]; reload: () => Promise<void> }

export function useProjectData(projectId: string | null, report: Report): ProjectData {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const reload = useCallback(async () => {
    if (!projectId) { setGraph(null); setEntries([]); setRuns([]); return; }
    try {
      const [g, e, r] = await Promise.all([api.graph(projectId), api.entries(projectId), api.runs(projectId)]);
      setGraph(g); setEntries(e); setRuns(r);
    } catch (e) { report(errorMessage(e)); }
  }, [projectId, report]);
  useEffect(() => { void reload(); }, [reload]);
  return { graph, entries, runs, reload };
}

/** A recorded run with its events, loaded on demand for replay and comparison. */
export function useRun(runId: string | null, report: Report): RunResult | null {
  const [result, setResult] = useState<RunResult | null>(null);
  useEffect(() => {
    let live = true;
    if (!runId) { setResult(null); return; }
    api.run(runId).then(r => { if (live) setResult(r); }, (e: unknown) => report(errorMessage(e)));
    return () => { live = false; };
  }, [runId, report]);
  return result?.run.id === runId ? result : null;
}

/** Usage summary for the header chip and Usage panel; `tick` changes after every run or answer to refetch. */
export function useUsage(projectId: string | null, tick: number, report: Report): UsageSummary | null {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    let live = true;
    api.usage(projectId ?? undefined).then(u => { if (live) setUsage(u); }, (e: unknown) => report(errorMessage(e)));
    return () => { live = false; };
  }, [projectId, tick, report]);
  return usage;
}
