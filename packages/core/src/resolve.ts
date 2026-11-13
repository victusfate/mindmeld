// Vocabulary shared by both static indexers (TypeScript in indexer.ts, tree-sitter in tree-index.ts): how a local
// name is bound to another file, and how a resolved call target becomes an edge.
import type { CodeSymbol, EdgeResolution, Span, StaticEdge } from './schema.ts';

/** What a local name refers to in another file; `name: null` binds the whole module, so `local.f()` targets `file#f`. */
export interface ResolvedImport { file: string; name: string | null }

/** A call target and how it was resolved. */
export type Target = [string, EdgeResolution];

/** The target only when `id` is a symbol of the project, so an edge never points at a declaration that was not indexed. */
export const known = (byId: ReadonlyMap<string, CodeSymbol>, id: string | null, how: EdgeResolution): Target[] =>
  (id && byId.has(id) ? [[id, how]] : []);

/** The enclosing type of a method (`Type` of `Type.f`), or null for a free function. */
export const ownType = (owner: CodeSymbol): string | null => (owner.kind === 'method' ? owner.name.split('.')[0] : null);

export const callEdge = (from: string, [to, resolution]: Target, site: Span): StaticEdge =>
  ({ provenance: 'static', from, to, kind: 'call', resolution, site });
