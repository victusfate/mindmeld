// Static index for the tree-sitter languages: runs each file's adapter, then links call sites across files.
// Parses only; never executes code. Every edge is a *possible* call, labelled with how it was resolved.
import { extname } from 'node:path';
import type { Grammars } from './grammars.ts';
import type { CallSite, ImportBinding, LanguageAdapter, ResolvedImport } from './languages/adapter.ts';
import { python } from './languages/python.ts';
import type { FileImport, StaticIndex } from './indexer.ts';
import type { CodeSymbol, EdgeResolution, SourceFile, StaticEdge } from './schema.ts';

const ADAPTERS: readonly LanguageAdapter[] = [python];
/** A method name shared by more symbols than this is too common to suggest a call (`get`, `new`, `_ready`). */
export const NAME_MATCH_LIMIT = 3;

export const adapterFor = (path: string): LanguageAdapter | undefined => ADAPTERS.find(a => a.extensions.includes(extname(path)));

interface FileFacts { adapter: LanguageAdapter; symbols: CodeSymbol[]; calls: CallSite[]; bindings: Map<string, ResolvedImport> }
interface Project { byId: Map<string, CodeSymbol>; methodsByName: Map<string, CodeSymbol[]> }
type Target = [string, EdgeResolution];

interface FileImports { adapter: LanguageAdapter; path: string; imports: ImportBinding[] }

/** Resolves one file's import bindings and appends its file-level imports to `out`. */
function resolveBindings({ adapter, path, imports }: FileImports, files: ReadonlySet<string>, out: FileImport[]): Map<string, ResolvedImport> {
  const bindings = new Map<string, ResolvedImport>();
  const names = new Map<string, string[]>();
  for (const binding of imports) {
    const resolved = adapter.resolveImport?.(path, binding, files);
    if (!resolved) continue;
    bindings.set(binding.local, resolved);
    names.set(resolved.file, [...(names.get(resolved.file) ?? []), ...(resolved.name ? [resolved.name] : [])]);
  }
  for (const [to, imported] of names) out.push({ from: path, to, names: imported });
  return bindings;
}

/** Name matches stay within one language: a Python `x.render()` never suggests a Rust method. */
const methodKey = (adapter: LanguageAdapter, name: string): string => `${adapter.language}:${name}`;
const known = (project: Project, id: string, how: EdgeResolution): Target[] => (project.byId.has(id) ? [[id, how]] : []);

function nameMatch(project: Project, file: FileFacts, callee: string): Target[] {
  const candidates = project.methodsByName.get(methodKey(file.adapter, callee)) ?? [];
  return candidates.length <= NAME_MATCH_LIMIT ? candidates.map((m): Target => [m.id, 'name-match']) : [];
}

function plainTargets(callee: string, file: FileFacts, project: Project): Target[] {
  const local = file.symbols.find(s => s.name === callee && s.kind === 'function');
  if (local) return [[local.id, 'local']];
  const bound = file.bindings.get(callee);
  return bound?.name ? known(project, `${bound.file}#${bound.name}`, 'import') : [];
}

function selfTargets(callee: string, owner: CodeSymbol, file: FileFacts, project: Project): Target[] {
  const own = owner.kind === 'method' ? known(project, `${owner.span.file}#${owner.name.split('.')[0]}.${callee}`, 'this-member') : [];
  return own.length ? own : nameMatch(project, file, callee);
}

function memberTargets(callee: string, object: string | null, file: FileFacts, project: Project): Target[] {
  const bound = object === null ? undefined : file.bindings.get(object);
  return bound && bound.name === null ? known(project, `${bound.file}#${callee}`, 'import') : nameMatch(project, file, callee);
}

function targets({ callee, receiver }: CallSite, owner: CodeSymbol, file: FileFacts, project: Project): Target[] {
  switch (receiver.kind) {
    case 'none': return plainTargets(callee, file, project);
    case 'self': return selfTargets(callee, owner, file, project);
    case 'member': return memberTargets(callee, receiver.object, file, project);
    case 'path': return nameMatch(project, file, callee);
  }
}

export function indexTreeSources(files: SourceFile[], contents: Map<string, string>, grammars: Grammars): StaticIndex {
  const fileSet = new Set(files.map(f => f.path));
  const imports: FileImport[] = [];
  const facts: FileFacts[] = [];
  for (const file of files) {
    const adapter = adapterFor(file.path);
    if (!adapter) continue;
    const extracted = grammars.withTree(adapter.language, contents.get(file.path) ?? '', root => adapter.extract(root, file));
    facts.push({ adapter, symbols: extracted.symbols, calls: extracted.calls, bindings: resolveBindings({ adapter, path: file.path, imports: extracted.imports }, fileSet, imports) });
  }
  const project: Project = { byId: new Map(), methodsByName: new Map() };
  for (const { adapter, symbols } of facts) {
    for (const symbol of symbols) {
      project.byId.set(symbol.id, symbol);
      if (symbol.kind !== 'method') continue;
      const key = methodKey(adapter, symbol.name.split('.').pop()!);
      project.methodsByName.set(key, [...(project.methodsByName.get(key) ?? []), symbol]);
    }
  }
  const edges: StaticEdge[] = facts.flatMap(file => file.calls.flatMap(call =>
    targets(call, project.byId.get(call.from)!, file, project)
      .map(([to, resolution]): StaticEdge => ({ provenance: 'static', from: call.from, to, kind: 'call', resolution, site: call.site }))));
  return { symbols: [...project.byId.values()], edges, imports };
}
