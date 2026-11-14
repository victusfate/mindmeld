// Connection and cached evidence for one workspace. All data comes from the Studio API through StudioClient;
// the extension never reads evidence any other way and never executes repository code itself.
import { StudioClient, type Graph, type Project, type Run, type Status, type TraceEvent, type UsageSummary } from '@mindmeld/client';

export class NotReadyError extends Error {}

export class Session {
  client: StudioClient | null = null;
  baseUrl = '';
  /** The access token of the current connection; held in memory only (secret storage keeps the external one). */
  token: string | null = null;
  projectId: string | null = null;
  graph: Graph | null = null;
  runs: Run[] = [];
  status: Status | null = null;
  usage: UsageSummary | null = null;
  private events = new Map<string, TraceEvent[]>();
  private listeners = new Set<() => void>();

  onChange(fn: () => void): { dispose(): void } {
    this.listeners.add(fn);
    return { dispose: () => { this.listeners.delete(fn); } };
  }

  notify(): void { for (const fn of this.listeners) fn(); }

  /** Verifies the token with an authenticated call before keeping the client. */
  async connect(baseUrl: string, token: string): Promise<Status> {
    const client = new StudioClient({ baseUrl, token });
    this.status = await client.status();
    this.client = client;
    this.baseUrl = baseUrl;
    this.token = token;
    await this.loadUsage();
    this.notify();
    return this.status;
  }

  /** Usage is informational: a failure leaves it unknown rather than failing the caller. */
  async loadUsage(): Promise<void> {
    try { this.usage = this.client ? await this.client.usage() : null; } catch { this.usage = null; }
  }

  disconnect(): void {
    this.client = null;
    this.token = null;
    this.status = null;
    this.usage = null;
    this.graph = null;
    this.runs = [];
    this.notify();
  }

  connected(): StudioClient {
    if (!this.client) throw new NotReadyError('Not connected: run "Mind Meld: Connect" first.');
    return this.client;
  }

  project(): { client: StudioClient; projectId: string } {
    const client = this.connected();
    if (!this.projectId) throw new NotReadyError('No project for this workspace: run "Mind Meld: Import Current Workspace".');
    return { client, projectId: this.projectId };
  }

  /** Reuses the project already imported from `root`, otherwise imports it as a local source. */
  async importRoot(root: string): Promise<Project> {
    const client = this.connected();
    const existing = (await client.projects()).find(p => p.sourceKind === 'local' && p.root === root);
    const project = existing ?? (await client.addProject('local', root)).project;
    if (existing) await client.refresh(existing.id);
    this.projectId = project.id;
    await this.reload();
    return project;
  }

  /** Restores a remembered project; forgets it when the server no longer has it. */
  async useProject(projectId: string): Promise<boolean> {
    const projects = await this.connected().projects();
    if (!projects.some(p => p.id === projectId)) return false;
    this.projectId = projectId;
    await this.reload();
    return true;
  }

  async reload(): Promise<void> {
    const { client, projectId } = this.project();
    const [graph, runs] = await Promise.all([client.graph(projectId), client.runs(projectId)]);
    this.graph = graph;
    this.runs = runs;
    this.events.clear();
    await this.loadUsage();
    this.notify();
  }

  async refresh(): Promise<void> {
    const { client, projectId } = this.project();
    await client.refresh(projectId);
    await this.reload();
  }

  async runEvents(runId: string): Promise<TraceEvent[]> {
    const cached = this.events.get(runId);
    if (cached) return cached;
    const { events } = await this.connected().run(runId);
    this.events.set(runId, events);
    return events;
  }
}
