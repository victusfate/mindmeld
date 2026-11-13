// Studio service: the single API every interface (server, desktop, VS Code) goes through.
import { sealBundle, validateBundle, type EvidenceBundle } from './bundle.ts';
import { resolveCitation, type CitationContext } from './citations.ts';
import { diffRuns, type RunDiff } from './diff.ts';
import { DEFAULT_LIMITS, importRepository, isSafeRelativePath, type ImportedRepo } from './import.ts';
import { indexSources, INDEXER_VERSION, type FileImport } from './indexer.ts';
import { askQuestion, ModelUnavailableError, type ModelConnector, type ModelStatus } from './qa.ts';
import { newId } from './hash.ts';
import { executeRun, type SandboxConnector, type SandboxStatus } from './runner.ts';
import { NotFoundError, type EvidenceStore, type Project } from './store.ts';
import { summarizeUsage, UNKNOWN_USAGE, type ModelUsage, type ProviderLimit, type UsageKind, type UsageRecord, type UsageSummary } from './usage.ts';
import type { Answer, CodeSymbol, Entry, ObservedEdge, RepoSnapshot, ResolvedCitation, Run, StaticEdge, TraceEvent } from './schema.ts';

export interface SourceRef { kind: string; ref: string; name?: string; include?: string[] }
/** Implemented by @mindmeld/connectors: turns a reference into a local, read-only directory. Never executes repo code. */
export interface SourceConnector {
  readonly kind: string;
  materialize(ref: string): Promise<{ root: string; name: string }>;
}

export interface StudioOptions { store: EvidenceStore; sandbox: SandboxConnector; model: ModelConnector | null; sources: SourceConnector[]; runDir?: string }
export interface Graph {
  project: Project;
  snapshot: RepoSnapshot;
  symbols: CodeSymbol[];
  staticEdges: StaticEdge[];
  observedEdges: ObservedEdge[];
  imports: FileImport[];
  staleRuns: number;
}
const RUN_TIMEOUT = { default: 10_000, min: 1000, max: 30_000 };
const MAX_INPUT_BYTES = 100_000;
const MAX_NOTE = 500;

export class ValidationError extends Error {}

export class Studio {
  readonly opts: StudioOptions;
  constructor(opts: StudioOptions) { this.opts = opts; }

  get store(): EvidenceStore { return this.opts.store; }

  async status(): Promise<{ sandbox: SandboxStatus & { name: string }; model: ModelStatus & { name: string | null }; indexer: string }> {
    const model = this.opts.model;
    return {
      sandbox: { name: this.opts.sandbox.name, ...(await this.opts.sandbox.status()) },
      model: model ? { name: model.name, ...(await model.status()) } : { name: null, available: false, reason: 'no model configured (optional)', model: null },
      indexer: INDEXER_VERSION,
    };
  }

  async addProject(source: SourceRef): Promise<{ project: Project; snapshot: RepoSnapshot }> {
    const connector = this.opts.sources.find(s => s.kind === source.kind);
    if (!connector) throw new ValidationError(`unknown source kind ${source.kind}`);
    const include = source.include?.length ? source.include : undefined;
    if (include?.some(dir => !isSafeRelativePath(dir))) throw new ValidationError('include entries must be repo-relative directories');
    const { root, name } = await connector.materialize(source.ref);
    const project = this.store.createProject({ name: source.name || name, sourceKind: source.kind, sourceRef: source.ref, root, include });
    return { project, snapshot: this.indexRepo(project, importRepository(root, DEFAULT_LIMITS, include)) };
  }

  private indexRepo(project: Project, repo: ImportedRepo): RepoSnapshot {
    const latest = this.store.latestSnapshot(project.id);
    if (latest && latest.snapshotHash === repo.snapshotHash) return latest;
    const started = performance.now();
    const snap = this.store.saveSnapshot(project.id, repo, indexSources(repo.files, repo.contents), INDEXER_VERSION);
    this.record({ kind: 'index', projectId: project.id, provider: INDEXER_VERSION, started, ok: true, detail: `${repo.files.length} files` });
    return snap;
  }

  private record(r: { kind: UsageKind; projectId: string | null; provider: string; started: number; ok: boolean; detail: string; usage?: ModelUsage; limits?: ProviderLimit[] | null }): void {
    const rec: UsageRecord = { ...(r.usage ?? UNKNOWN_USAGE), limits: r.limits ?? null, id: newId('use'), at: new Date().toISOString(), kind: r.kind, projectId: r.projectId,
      provider: r.provider, durationMs: performance.now() - r.started, ok: r.ok, detail: r.detail.slice(0, MAX_NOTE) };
    this.store.recordUsage(rec);
  }

  /** Usage shared back to every interface; `projectId` narrows it to one project. */
  usage(projectId?: string): UsageSummary { return summarizeUsage(this.store.usage(projectId)); }

  usageRecords(projectId?: string): UsageRecord[] { return this.store.usage(projectId); }

  /** Re-read the source; a changed snapshot hash creates a new snapshot and makes older runs stale. */
  refresh(projectId: string): RepoSnapshot {
    const project = this.store.getProject(projectId);
    if (project.sourceKind === 'bundle') return this.snapshot(projectId);
    return this.indexRepo(project, importRepository(project.root, DEFAULT_LIMITS, project.include));
  }

  snapshot(projectId: string): RepoSnapshot {
    const snap = this.store.latestSnapshot(projectId);
    if (!snap) throw new NotFoundError(`project ${projectId} has no snapshot`);
    return snap;
  }

  withFreshness(run: Run, snap: RepoSnapshot): Run {
    const current = new Map(snap.files.map(f => [f.path, f.hash]));
    const staleFiles = Object.entries(run.fileHashes).filter(([p, h]) => current.get(p) !== h).map(([p]) => p);
    for (const p of current.keys()) if (!(p in run.fileHashes)) staleFiles.push(p);
    return { ...run, stale: staleFiles.length > 0, staleFiles };
  }

  runs(projectId: string): Run[] {
    const snap = this.snapshot(projectId);
    return this.store.runs(projectId).map(r => this.withFreshness(r, snap));
  }

  run(runId: string): { run: Run; events: TraceEvent[] } {
    const run = this.store.getRun(runId);
    return { run: this.withFreshness(run, this.snapshot(run.projectId)), events: this.store.events(runId) };
  }

  graph(projectId: string): Graph {
    const project = this.store.getProject(projectId);
    const snapshot = this.snapshot(projectId);
    const runs = this.runs(projectId);
    const observed = new Map<string, ObservedEdge>();
    for (const run of runs.filter(r => !r.stale)) {
      const events = this.store.events(run.id);
      for (const e of events) {
        if (e.parent === null) continue;
        const from = events[e.parent].symbol;
        const key = `${from}→${e.symbol}`;
        const edge = observed.get(key) ?? { provenance: 'observed', from, to: e.symbol, runIds: [], count: 0 };
        edge.count++;
        if (!edge.runIds.includes(run.id)) edge.runIds.push(run.id);
        observed.set(key, edge);
      }
    }
    return { project, snapshot, symbols: this.store.symbols(snapshot.id), staticEdges: this.store.edges(snapshot.id), observedEdges: [...observed.values()],
      imports: this.store.imports(snapshot.id), staleRuns: runs.filter(r => r.stale).length };
  }

  source(projectId: string, path: string): { path: string; hash: string; language: string; content: string } {
    const file = this.snapshot(projectId).files.find(f => f.path === path);
    if (!file) throw new NotFoundError(`file ${path} is not in the snapshot`);
    return { path, hash: file.hash, language: file.language, content: this.store.blob(file.hash) ?? '' };
  }

  private symbol(projectId: string, symbolId: string): CodeSymbol {
    const s = this.store.symbols(this.snapshot(projectId).id).find(x => x.id === symbolId);
    if (!s) throw new NotFoundError(`symbol ${symbolId} is not in the latest snapshot`);
    return s;
  }

  /** Allowlisting is an explicit user act stored by Studio; nothing in the studied repo can register an entry. */
  addEntry(projectId: string, symbolId: string, note = ''): Entry {
    const s = this.symbol(projectId, symbolId);
    if (!s.exported || !['function', 'variable-function'].includes(s.kind)) throw new ValidationError('only exported functions can be allowlisted');
    return this.store.addEntry(projectId, symbolId, note.slice(0, MAX_NOTE));
  }

  entries(projectId: string): Entry[] { return this.store.entries(projectId); }

  async execute(projectId: string, entryId: string, inputs: unknown, options: { timeoutMs?: number } = {}): Promise<{ run: Run; events: TraceEvent[] }> {
    const entry = this.store.entries(projectId).find(e => e.id === entryId);
    if (!entry) throw new ValidationError('entry is not allowlisted for this project');
    if (!Array.isArray(inputs) || JSON.stringify(inputs).length > MAX_INPUT_BYTES) throw new ValidationError('inputs must be a JSON array (≤100 KB)');
    const project = this.store.getProject(projectId);
    if (project.sourceKind === 'bundle') throw new ValidationError('imported bundles are inspect-only; they cannot be executed');
    const snap = this.refresh(projectId);
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? RUN_TIMEOUT.default, RUN_TIMEOUT.min), RUN_TIMEOUT.max);
    const started = performance.now();
    const result = await executeRun(this.opts.sandbox, {
      projectId, snapshotId: snap.id, snapshotHash: snap.snapshotHash, contents: this.store.contents(snap.id),
      fileHashes: Object.fromEntries(snap.files.map(f => [f.path, f.hash])), symbols: this.store.symbols(snap.id),
      entry: this.symbol(projectId, entry.symbolId), inputs, timeoutMs, workRoot: this.opts.runDir,
    });
    if (this.refresh(projectId).snapshotHash !== snap.snapshotHash) throw new ValidationError('source changed during execution; run discarded');
    this.store.saveRun(result.run, result.events);
    this.record({ kind: 'run', projectId, provider: this.opts.sandbox.name, started, ok: result.run.status === 'ok', detail: `${result.run.id} ${result.run.status} ${result.events.length} events` });
    return { run: this.withFreshness(result.run, snap), events: result.events };
  }

  diff(runA: string, runB: string): RunDiff {
    const a = this.run(runA), b = this.run(runB);
    if (a.run.projectId !== b.run.projectId) throw new ValidationError('runs belong to different projects');
    return diffRuns(a.run, a.events, b.run, b.events);
  }

  citationContext(projectId: string): CitationContext & { contents: Map<string, string>; allEvents: TraceEvent[] } {
    const snap = this.snapshot(projectId);
    const runs = this.runs(projectId);
    const fresh = runs.filter(r => !r.stale).reverse();
    return {
      symbols: new Map(this.store.symbols(snap.id).map(s => [s.id, s])),
      runs: new Map(runs.map(r => [r.id, r])),
      events: id => this.store.events(id),
      contents: this.store.contents(snap.id),
      allEvents: fresh.flatMap(r => this.store.events(r.id)),
    };
  }

  resolve(projectId: string, kind: 'symbol' | 'event', ref: string, pinnedHash?: string): ResolvedCitation {
    return resolveCitation({ kind, ref }, this.citationContext(projectId), pinnedHash);
  }

  async ask(projectId: string, question: string): Promise<Answer> {
    if (!this.opts.model) throw new ModelUnavailableError('no local model configured; maps, traces and citations still work');
    const started = performance.now();
    try {
      const answer = await askQuestion(question, this.opts.model, this.citationContext(projectId));
      this.record({ kind: 'model', projectId, provider: this.opts.model.name, started, ok: true, detail: answer.abstained ? 'abstained' : 'answered', usage: answer.usage ?? undefined, limits: answer.limits });
      return answer;
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) this.record({ kind: 'model', projectId, provider: this.opts.model.name, started, ok: false, detail: (error as Error).message });
      throw error;
    }
  }

  exportBundle(projectId: string): EvidenceBundle {
    const project = this.store.getProject(projectId);
    const snap = this.snapshot(projectId);
    const runs = this.store.runs(projectId).filter(r => r.snapshotHash === snap.snapshotHash);
    return sealBundle({
      name: project.name, snapshotHash: snap.snapshotHash, indexerVersion: snap.indexerVersion, files: snap.files,
      sources: Object.fromEntries(this.store.contents(snap.id)), symbols: this.store.symbols(snap.id), edges: this.store.edges(snap.id),
      runs, events: Object.fromEntries(runs.map(r => [r.id, this.store.events(r.id)])),
    });
  }

  importBundle(value: unknown): Project {
    const b = validateBundle(value);
    const project = this.store.createProject({ name: `${b.name} (bundle)`, sourceKind: 'bundle', sourceRef: b.bundleHash, root: '' });
    const contents = new Map(Object.entries(b.sources));
    const snap = this.store.saveSnapshot(project.id, { files: b.files, contents, skipped: [], snapshotHash: b.snapshotHash },
      { symbols: b.symbols, edges: b.edges, imports: [] }, b.indexerVersion);
    for (const run of b.runs) {
      const id = newId('run');   // imported runs get local ids; the bundle hash records their origin
      this.store.saveRun({ ...run, id, imported: true, projectId: project.id, snapshotId: snap.id }, (b.events[run.id] ?? []).map(e => ({ ...e, runId: id })));
    }
    return project;
  }
}

export { ModelUnavailableError, NotFoundError };
