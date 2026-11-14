// SQLite evidence store (node:sqlite, no native addon). Lives outside the studied repository.
// File contents are content-addressed; runs and trace events are immutable once written.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newId } from './hash.ts';
import type { ImportedRepo } from './import.ts';
import type { FileImport, StaticIndex } from './indexer.ts';
import type { UsageRecord } from './usage.ts';
import type { CodeSymbol, Entry, RepoSnapshot, Run, SourceFile, StaticEdge, TraceEvent } from './schema.ts';

export interface Project {
  id: string; name: string; sourceKind: string; sourceRef: string; root: string; createdAt: string;
  /** Import scope: repo-relative directories; absent means the whole repository. */
  include?: string[];
}

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_kind TEXT NOT NULL, source_ref TEXT NOT NULL, root TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE blobs (hash TEXT PRIMARY KEY, content TEXT NOT NULL);
   CREATE TABLE snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot_hash TEXT NOT NULL,
     created_at TEXT NOT NULL, indexer_version TEXT NOT NULL, skipped TEXT NOT NULL, imports TEXT NOT NULL);
   CREATE TABLE snapshot_files (snapshot_id TEXT NOT NULL REFERENCES snapshots(id), path TEXT NOT NULL, hash TEXT NOT NULL REFERENCES blobs(hash),
     bytes INTEGER NOT NULL, language TEXT NOT NULL, PRIMARY KEY (snapshot_id, path));
   CREATE TABLE symbols (snapshot_id TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
   CREATE TABLE edges (snapshot_id TEXT NOT NULL REFERENCES snapshots(id), data TEXT NOT NULL);
   CREATE TABLE entries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), symbol_id TEXT NOT NULL, note TEXT NOT NULL,
     created_at TEXT NOT NULL, UNIQUE (project_id, symbol_id));
   CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), created_at TEXT NOT NULL, data TEXT NOT NULL);
   CREATE TABLE events (run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, seq));
   CREATE TRIGGER runs_immutable BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'runs are immutable'); END;
   CREATE TRIGGER events_immutable BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'trace events are immutable'); END;`,
  `CREATE TABLE usage (id TEXT PRIMARY KEY, at TEXT NOT NULL, project_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL);
   CREATE INDEX usage_project ON usage (project_id, at);
   CREATE TRIGGER usage_append_only BEFORE UPDATE ON usage BEGIN SELECT RAISE(ABORT, 'usage records are append-only'); END;`,
  `ALTER TABLE projects ADD COLUMN include_paths TEXT;`,
];

type Row = Record<string, unknown>;
const json = <T>(row: Row | undefined, key = 'data'): T => JSON.parse(String(row?.[key])) as T;

export class EvidenceStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
    if (version > MIGRATIONS.length) throw new Error(`evidence store schema ${version} is newer than this build (${MIGRATIONS.length})`);
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.tx(() => { this.db.exec(MIGRATIONS[v]); this.db.exec(`PRAGMA user_version = ${v + 1}`); });
    }
  }

  tx<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out = work(); this.db.exec('COMMIT'); return out; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  close(): void { this.db.close(); }

  createProject(p: Omit<Project, 'id' | 'createdAt'>): Project {
    const project: Project = { ...p, id: newId('prj'), createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(project.id, project.name, project.sourceKind, project.sourceRef, project.root, project.createdAt, project.include ? JSON.stringify(project.include) : null);
    return project;
  }

  listProjects(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY created_at').all() as Row[]).map(toProject);
  }

  getProject(id: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`project ${id} not found`);
    return toProject(row);
  }

  saveSnapshot(projectId: string, repo: ImportedRepo, index: StaticIndex, indexerVersion: string): RepoSnapshot {
    const snapshot: RepoSnapshot = { id: newId('snap'), projectId, snapshotHash: repo.snapshotHash, createdAt: new Date().toISOString(), indexerVersion, files: repo.files, skipped: repo.skipped };
    this.tx(() => {
      this.db.prepare('INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?)').run(snapshot.id, projectId, snapshot.snapshotHash, snapshot.createdAt, indexerVersion, JSON.stringify(repo.skipped), JSON.stringify(index.imports));
      const blob = this.db.prepare('INSERT OR IGNORE INTO blobs VALUES (?, ?)');
      const file = this.db.prepare('INSERT INTO snapshot_files VALUES (?, ?, ?, ?, ?)');
      for (const f of repo.files) { blob.run(f.hash, repo.contents.get(f.path) ?? ''); file.run(snapshot.id, f.path, f.hash, f.bytes, f.language); }
      const sym = this.db.prepare('INSERT INTO symbols VALUES (?, ?, ?)');
      for (const s of index.symbols) sym.run(snapshot.id, s.id, JSON.stringify(s));
      const edge = this.db.prepare('INSERT INTO edges VALUES (?, ?)');
      for (const e of index.edges) edge.run(snapshot.id, JSON.stringify(e));
    });
    return snapshot;
  }

  latestSnapshot(projectId: string): RepoSnapshot | null {
    const row = this.db.prepare('SELECT id FROM snapshots WHERE project_id = ? ORDER BY rowid DESC LIMIT 1').get(projectId) as Row | undefined;
    return row ? this.getSnapshot(String(row.id)) : null;
  }

  getSnapshot(id: string): RepoSnapshot {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`snapshot ${id} not found`);
    const files = (this.db.prepare('SELECT path, hash, bytes, language FROM snapshot_files WHERE snapshot_id = ? ORDER BY path').all(id) as Row[])
      .map(r => ({ path: String(r.path), hash: String(r.hash), bytes: Number(r.bytes), language: String(r.language) }) as SourceFile);
    return { id, projectId: String(row.project_id), snapshotHash: String(row.snapshot_hash), createdAt: String(row.created_at),
      indexerVersion: String(row.indexer_version), files, skipped: json(row, 'skipped') };
  }

  imports(snapshotId: string): FileImport[] {
    return json(this.db.prepare('SELECT imports FROM snapshots WHERE id = ?').get(snapshotId) as Row, 'imports');
  }

  contents(snapshotId: string): Map<string, string> {
    const rows = this.db.prepare('SELECT f.path, b.content FROM snapshot_files f JOIN blobs b ON b.hash = f.hash WHERE f.snapshot_id = ?').all(snapshotId) as Row[];
    return new Map(rows.map(r => [String(r.path), String(r.content)]));
  }

  blob(hash: string): string | null {
    const row = this.db.prepare('SELECT content FROM blobs WHERE hash = ?').get(hash) as Row | undefined;
    return row ? String(row.content) : null;
  }

  symbols(snapshotId: string): CodeSymbol[] {
    return (this.db.prepare('SELECT data FROM symbols WHERE snapshot_id = ?').all(snapshotId) as Row[]).map(r => json<CodeSymbol>(r));
  }

  edges(snapshotId: string): StaticEdge[] {
    return (this.db.prepare('SELECT data FROM edges WHERE snapshot_id = ?').all(snapshotId) as Row[]).map(r => json<StaticEdge>(r));
  }

  addEntry(projectId: string, symbolId: string, note: string): Entry {
    const existing = this.db.prepare('SELECT * FROM entries WHERE project_id = ? AND symbol_id = ?').get(projectId, symbolId) as Row | undefined;
    if (existing) return toEntry(existing);
    const entry: Entry = { id: newId('ent'), projectId, symbolId, note, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)').run(entry.id, projectId, symbolId, note, entry.createdAt);
    return entry;
  }

  entries(projectId: string): Entry[] {
    return (this.db.prepare('SELECT * FROM entries WHERE project_id = ? ORDER BY created_at').all(projectId) as Row[]).map(toEntry);
  }

  saveRun(run: Run, events: TraceEvent[]): void {
    this.tx(() => {
      this.db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?)').run(run.id, run.projectId, run.createdAt, JSON.stringify(run));
      const ev = this.db.prepare('INSERT INTO events VALUES (?, ?, ?)');
      for (const e of events) ev.run(run.id, e.seq, JSON.stringify(e));
    });
  }

  runs(projectId: string): Run[] {
    return (this.db.prepare('SELECT data FROM runs WHERE project_id = ? ORDER BY rowid').all(projectId) as Row[]).map(r => json<Run>(r));
  }

  getRun(id: string): Run {
    const row = this.db.prepare('SELECT data FROM runs WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`run ${id} not found`);
    return json<Run>(row);
  }

  recordUsage(r: UsageRecord): void {
    this.db.prepare('INSERT INTO usage VALUES (?, ?, ?, ?, ?)').run(r.id, r.at, r.projectId, r.kind, JSON.stringify(r));
  }

  usage(projectId?: string): UsageRecord[] {
    const rows = projectId
      ? this.db.prepare('SELECT data FROM usage WHERE project_id = ? ORDER BY rowid').all(projectId)
      : this.db.prepare('SELECT data FROM usage ORDER BY rowid').all();
    return (rows as Row[]).map(r => json<UsageRecord>(r));
  }

  events(runId: string): TraceEvent[] {
    return (this.db.prepare('SELECT data FROM events WHERE run_id = ? ORDER BY seq').all(runId) as Row[]).map(r => json<TraceEvent>(r));
  }
}

export class NotFoundError extends Error {}

function toProject(r: Row): Project {
  const project: Project = { id: String(r.id), name: String(r.name), sourceKind: String(r.source_kind), sourceRef: String(r.source_ref), root: String(r.root), createdAt: String(r.created_at) };
  return typeof r.include_paths === 'string' ? { ...project, include: JSON.parse(r.include_paths) as string[] } : project;
}
function toEntry(r: Row): Entry {
  return { id: String(r.id), projectId: String(r.project_id), symbolId: String(r.symbol_id), note: String(r.note), createdAt: String(r.created_at) };
}
