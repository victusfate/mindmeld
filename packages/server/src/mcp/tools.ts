// The tools Mind Meld offers agents over MCP, all about one imported project: an overview, symbol search, a symbol
// with its source and its static and observed calls, a file outline, and re-indexing. Answers are plain text built
// from the index; static edges say how they were resolved, so an agent can weigh a `name-match` accordingly.
import { SYMBOL_KINDS, type CodeSymbol, type Graph, type ObservedEdge, type StaticEdge, type Studio } from '@mindmeld/core';
import { countBy, push } from '../collections.ts';
import { shortHash } from '../format.ts';
import type { Tool } from './protocol.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const TOP = 10;
const MAX_SOURCE_LINES = 200;

const where = (s: CodeSymbol): string => `${s.span.file}:${s.span.startLine}-${s.span.endLine}`;
const line = (s: CodeSymbol): string => `${s.id}  ${s.kind}${s.exported ? ' exported' : ''}  ${where(s)}`;
const edgeLine = (id: string, e: StaticEdge): string => `  ${id} (${e.resolution}, ${e.site.file}:${e.site.startLine})`;

const tally = (values: readonly string[]): string => countBy(values).map(([k, n]) => `${k} ${n}`).join(', ');

const top = (counts: Iterable<[string, number]>): string[] =>
  [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP).map(([k, n]) => `  ${k} (${n})`);

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function limitArg(args: Record<string, unknown>): number {
  const value = args.limit ?? DEFAULT_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('limit must be a positive integer');
  return Math.min(value, MAX_LIMIT);
}

/** Exact name first, then prefix, then substring of the name or id; ties by id. */
function rank(query: string, s: CodeSymbol): number {
  const q = query.toLowerCase();
  const name = s.name.toLowerCase();
  const short = name.split('.').at(-1) ?? name;
  if (name === q || short === q) return 0;
  if (name.startsWith(q) || short.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  return s.id.toLowerCase().includes(q) ? 3 : -1;
}

/** One graph with lookups built once, so each tool call is a map read even on a 40k-symbol repo. */
interface Index {
  version: string;
  graph: Graph;
  byId: Map<string, CodeSymbol>;
  byFile: Map<string, CodeSymbol[]>;
  callers: Map<string, StaticEdge[]>;
  callees: Map<string, StaticEdge[]>;
  observed: Map<string, ObservedEdge[]>;
  calls: StaticEdge[];
}

function indexOf(graph: Graph, version: string): Index {
  const index: Index = { version, graph, byId: new Map(), byFile: new Map(), callers: new Map(), callees: new Map(), observed: new Map(), calls: [] };
  for (const s of graph.symbols) { index.byId.set(s.id, s); push(index.byFile, s.span.file, s); }
  for (const list of index.byFile.values()) list.sort((a, b) => a.span.startLine - b.span.startLine);
  index.calls = graph.staticEdges.filter(e => e.kind === 'call');
  for (const e of index.calls) { push(index.callers, e.to, e); push(index.callees, e.from, e); }
  for (const e of graph.observedEdges) { push(index.observed, e.from, e); if (e.to !== e.from) push(index.observed, e.to, e); }
  return index;
}

export class ProjectTools {
  private readonly studio: Studio;
  private readonly projectId: string;
  private cached: Index | null = null;

  constructor(studio: Studio, projectId: string) { this.studio = studio; this.projectId = projectId; }

  /** Rebuilt when a refresh (here or in the browser) or a recorded run changes the evidence. */
  private index(): Index {
    const version = this.studio.store.evidenceVersion(this.projectId);
    if (this.cached?.version !== version) this.cached = indexOf(this.studio.graph(this.projectId), version);
    return this.cached;
  }

  overview(): string {
    const { graph: g, calls, callers, byFile } = this.index();
    return [
      `${g.project.name} at ${g.project.root}${g.project.include ? ` (include: ${g.project.include.join(', ')})` : ''}`,
      `snapshot ${shortHash(g.snapshot.snapshotHash)} · indexer ${g.snapshot.indexerVersion}`,
      `files: ${g.snapshot.files.length} (${tally(g.snapshot.files.map(f => f.language))})`,
      `symbols: ${g.symbols.length} (${tally(g.symbols.map(s => s.kind))})`,
      `static call edges: ${calls.length} (${tally(calls.map(e => e.resolution))}); observed call edges: ${g.observedEdges.length}`,
      'most-called symbols (static callers):', ...top([...callers].map(([id, es]) => [id, es.length])),
      'files with the most symbols:', ...top([...byFile].map(([file, ss]) => [file, ss.length])),
    ].join('\n');
  }

  findSymbols(args: Record<string, unknown>): string {
    const query = stringArg(args, 'query');
    const kind = args.kind;
    const hits = this.index().graph.symbols
      .filter(s => kind === undefined || s.kind === kind)
      .map(s => ({ s, r: rank(query, s) })).filter(h => h.r >= 0)
      .sort((a, b) => a.r - b.r || a.s.id.localeCompare(b.s.id));
    const shown = hits.slice(0, limitArg(args));
    if (!shown.length) return `no symbols match "${query}"`;
    return [`${hits.length} match${hits.length === 1 ? '' : 'es'}${hits.length > shown.length ? ` (first ${shown.length})` : ''}:`, ...shown.map(h => line(h.s))].join('\n');
  }

  symbol(args: Record<string, unknown>): string {
    const id = stringArg(args, 'id');
    const ix = this.index();
    const s = ix.byId.get(id);
    if (!s) throw new Error(`no symbol ${id}; use find_symbols to look ids up`);
    const callers = (ix.callers.get(s.id) ?? []).map(e => edgeLine(e.from, e));
    const callees = (ix.callees.get(s.id) ?? []).map(e => edgeLine(e.to, e));
    const observed = (ix.observed.get(s.id) ?? []).map(e => `  ${e.from} → ${e.to} ×${e.count} in ${e.runIds.length} run(s)`);
    const lines = (this.studio.store.blob(s.fileHash) ?? '').split('\n').slice(s.span.startLine - 1, s.span.endLine);
    const shown = lines.slice(0, MAX_SOURCE_LINES);
    return [
      `${s.id}  ${s.kind}${s.exported ? ' exported' : ''}${s.async ? ' async' : ''}  params (${s.params.join(', ')})`,
      `${where(s)} · file hash ${shortHash(s.fileHash)}`,
      '```', ...shown.map((text, i) => `${s.span.startLine + i}  ${text}`), ...(lines.length > shown.length ? [`… ${lines.length - shown.length} more lines`] : []), '```',
      `static callers (${callers.length}):`, ...callers,
      `static callees (${callees.length}):`, ...callees,
      `observed in runs (${observed.length}):`, ...observed,
    ].join('\n');
  }

  fileSymbols(args: Record<string, unknown>): string {
    const path = stringArg(args, 'path').replace(/^\.\//, '');
    const ix = this.index();
    const symbols = ix.byFile.get(path);
    if (symbols) return symbols.map(line).join('\n');
    return ix.graph.snapshot.files.some(f => f.path === path) ? `${path} is imported but has no indexed symbols` : `${path} is not in the snapshot (paths are repo-relative)`;
  }

  refresh(): string {
    const snap = this.studio.refresh(this.projectId);
    return `snapshot ${shortHash(snap.snapshotHash)} · ${snap.files.length} files · indexer ${snap.indexerVersion}`;
  }

  list(): Tool[] {
    const none = { type: 'object' as const, properties: {} };
    return [
      { name: 'overview', description: 'Summary of the indexed repository: languages, symbol and call-edge counts, the most-called symbols and the files with the most symbols. Start here.', inputSchema: none, run: () => this.overview() },
      {
        name: 'find_symbols', description: 'Find functions, classes and methods by name (case-insensitive; exact, then prefix, then substring). Returns symbol ids for the other tools.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: [...SYMBOL_KINDS] }, limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT } }, required: ['query'] },
        run: a => this.findSymbols(a),
      },
      {
        name: 'symbol', description: 'One symbol by id: its source, static callers and callees (with how each call was resolved: local, import, this-member or the weaker name-match) and calls observed in recorded runs.',
        inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'e.g. src/game.ts#playTurn' } }, required: ['id'] },
        run: a => this.symbol(a),
      },
      {
        name: 'file_symbols', description: 'Outline of one file: its indexed symbols in line order.',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'repo-relative path' } }, required: ['path'] },
        run: a => this.fileSymbols(a),
      },
      { name: 'refresh', description: 'Re-import and re-index the repository after it changed on disk.', inputSchema: none, run: () => this.refresh() },
    ];
  }
}
