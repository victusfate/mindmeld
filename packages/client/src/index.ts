// Typed client for the Studio API. Browser callers rely on the HttpOnly session cookie (pass no token);
// Node callers (VS Code, desktop, scripts) pass the bearer token. Types are imported type-only, so the
// browser bundle never pulls in core's Node code.
import type { Answer, CodeSymbol, Entry, FileImport, ObservedEdge, RepoSnapshot, ResolvedCitation, Run, RunDiff, StaticEdge, TraceEvent } from '@mindmeld/core';

export type { Answer, CodeSymbol, Entry, FileImport, ObservedEdge, RepoSnapshot, ResolvedCitation, Run, RunDiff, StaticEdge, TraceEvent };
export interface Project { id: string; name: string; sourceKind: string; sourceRef: string; root: string; createdAt: string }
export interface Graph {
  project: Project; snapshot: RepoSnapshot; symbols: CodeSymbol[]; staticEdges: StaticEdge[]; observedEdges: ObservedEdge[];
  imports: FileImport[]; staleRuns: number;
}
export interface Status {
  apiVersion: number; indexer: string;
  sandbox: { name: string; available: boolean; reason: string; runtime: string | null };
  model: { name: string | null; available: boolean; reason: string; model: string | null };
}
export interface SourceFileContent { path: string; hash: string; language: string; content: string }
export interface RunResult { run: Run; events: TraceEvent[] }

function parseJson(text: string): unknown {
  try { return text ? JSON.parse(text) : null; } catch { return { error: text }; }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface ClientOptions { baseUrl?: string; token?: string; fetch?: typeof fetch }

export class StudioClient {
  private readonly base: string;
  private readonly token: string | undefined;
  private readonly doFetch: typeof fetch;

  constructor(o: ClientOptions = {}) {
    this.base = (o.baseUrl ?? '').replace(/\/$/, '');
    this.token = o.token;
    this.doFetch = o.fetch ?? fetch.bind(globalThis);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.doFetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    const text = await res.text();
    const data = parseJson(text);
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  private p(id: string): string { return `/api/projects/${encodeURIComponent(id)}`; }

  health(): Promise<{ ok: boolean; apiVersion: number }> { return this.call('GET', '/api/health'); }
  status(): Promise<Status> { return this.call('GET', '/api/status'); }
  projects(): Promise<Project[]> { return this.call('GET', '/api/projects'); }
  addProject(kind: 'local' | 'git', ref: string, name?: string): Promise<{ project: Project; snapshot: RepoSnapshot }> {
    return this.call('POST', '/api/projects', { kind, ref, name });
  }
  project(id: string): Promise<{ project: Project; snapshot: RepoSnapshot }> { return this.call('GET', this.p(id)); }
  refresh(id: string): Promise<RepoSnapshot> { return this.call('POST', `${this.p(id)}/refresh`); }
  graph(id: string): Promise<Graph> { return this.call('GET', `${this.p(id)}/graph`); }
  source(id: string, path: string): Promise<SourceFileContent> { return this.call('GET', `${this.p(id)}/source?path=${encodeURIComponent(path)}`); }
  entries(id: string): Promise<Entry[]> { return this.call('GET', `${this.p(id)}/entries`); }
  addEntry(id: string, symbolId: string, note = ''): Promise<Entry> { return this.call('POST', `${this.p(id)}/entries`, { symbolId, note }); }
  runs(id: string): Promise<Run[]> { return this.call('GET', `${this.p(id)}/runs`); }
  execute(id: string, entryId: string, inputs: unknown[], timeoutMs?: number): Promise<RunResult> {
    return this.call('POST', `${this.p(id)}/runs`, { entryId, inputs, timeoutMs });
  }
  run(runId: string): Promise<RunResult> { return this.call('GET', `/api/runs/${encodeURIComponent(runId)}`); }
  diff(a: string, b: string): Promise<RunDiff> { return this.call('GET', `/api/runs/${encodeURIComponent(a)}/diff/${encodeURIComponent(b)}`); }
  ask(id: string, question: string): Promise<Answer> { return this.call('POST', `${this.p(id)}/ask`, { question }); }
  citation(id: string, kind: 'symbol' | 'event', ref: string, hash?: string): Promise<ResolvedCitation> {
    const q = new URLSearchParams({ kind, ref, ...(hash ? { hash } : {}) });
    return this.call('GET', `${this.p(id)}/citation?${q.toString()}`);
  }
  exportBundle(id: string): Promise<unknown> { return this.call('GET', `${this.p(id)}/bundle`); }
  importBundle(bundle: unknown): Promise<Project> { return this.call('POST', '/api/bundles', bundle); }
}
