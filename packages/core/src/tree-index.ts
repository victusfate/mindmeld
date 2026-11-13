// Static index for the tree-sitter languages: runs each file's adapter, then links call sites across files.
// Parses only; never executes code. Every edge is a *possible* call, labelled with how it was resolved.
import { extname } from 'node:path';
import type { Grammars } from './grammars.ts';
import type { CallSite, ImportBinding, LanguageAdapter, ResolvedImport } from './languages/adapter.ts';
import { python } from './languages/python.ts';
import { rust } from './languages/rust.ts';
import { gdscript } from './languages/gdscript.ts';
import type { FileImport, StaticIndex } from './indexer.ts';
import type { CodeSymbol, EdgeResolution, SourceFile, StaticEdge } from './schema.ts';

const ADAPTERS: readonly LanguageAdapter[] = [python, rust, gdscript];
/** A name shared by more symbols than this is too common to suggest a call. */
export const NAME_MATCH_LIMIT = 3;

export const adapterFor = (path: string): LanguageAdapter | undefined => ADAPTERS.find(a => a.extensions.includes(extname(path)));

interface FileFacts { adapter: LanguageAdapter; symbols: CodeSymbol[]; calls: CallSite[]; bindings: Map<string, ResolvedImport> }
/** `byName` keys are `language:kind:name`: free functions by name, methods by qualified name (`Type.name`).
 * `globalTypes` maps `language:Name` to the file declaring that global type (GDScript `class_name`). */
interface Project { byId: Map<string, CodeSymbol>; byName: Map<string, CodeSymbol[]>; globalTypes: Map<string, string> }
type NameKind = 'function' | 'qualified';
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
const nameKey = (adapter: LanguageAdapter, kind: NameKind, name: string): string => `${adapter.language}:${kind}:${name}`;

function addName(project: Project, key: string, symbol: CodeSymbol): void {
  project.byName.set(key, [...(project.byName.get(key) ?? []), symbol]);
}
const known = (project: Project, id: string, how: EdgeResolution): Target[] => (project.byId.has(id) ? [[id, how]] : []);

function nameMatch(project: Project, file: FileFacts, kind: NameKind, name: string): Target[] {
  const candidates = project.byName.get(nameKey(file.adapter, kind, name)) ?? [];
  return candidates.length <= NAME_MATCH_LIMIT ? candidates.map((m): Target => [m.id, 'name-match']) : [];
}

/** The enclosing type of a method (`Type` of `Type.f`), or null for a free function. */
const ownType = (owner: CodeSymbol): string | null => (owner.kind === 'method' ? owner.name.split('.')[0] : null);

function plainTargets(callee: string, owner: CodeSymbol, file: FileFacts, project: Project): Target[] {
  const type = file.adapter.implicitSelf ? ownType(owner) : null;
  const local = file.symbols.find(s => s.kind !== 'class' && s.name === (type ? `${type}.${callee}` : callee))
    ?? file.symbols.find(s => s.name === callee && s.kind === 'function');
  if (local) return [[local.id, 'local']];
  const bound = file.bindings.get(callee);
  if (bound?.name) return known(project, `${bound.file}#${bound.name}`, 'import');
  return file.adapter.matchFreeFunctions ? nameMatch(project, file, 'function', callee) : [];
}

/** `self.f()`: a method of the owner's type, or for a free function in a self-bearing script (GDScript) a function of the same file. */
function selfTargets(callee: string, owner: CodeSymbol, file: FileFacts, project: Project): Target[] {
  const type = ownType(owner);
  return known(project, `${owner.span.file}#${type ? `${type}.` : ''}${callee}`, 'this-member');
}

/** `m.f()` resolves only through a module import; any other receiver's type is unknown, so no edge is guessed. */
function memberTargets(callee: string, object: string | null, file: FileFacts, project: Project): Target[] {
  const bound = object === null ? undefined : file.bindings.get(object);
  return bound && bound.name === null ? known(project, `${bound.file}#${callee}`, 'import') : [];
}

/** `Type::f()` / `Type.f()`: a method qualified by that type, a function of the file declaring that global type,
 * or (Rust, where `module::f()` looks the same) a free function by name. */
function pathTargets(callee: string, path: string, file: FileFacts, project: Project): Target[] {
  const qualified = nameMatch(project, file, 'qualified', `${path}.${callee}`);
  if (qualified.length) return qualified;
  const declaring = project.globalTypes.get(`${file.adapter.language}:${path}`);
  const global = declaring ? known(project, `${declaring}#${callee}`, 'import') : [];
  if (global.length) return global;
  return file.adapter.matchFreeFunctions ? nameMatch(project, file, 'function', callee) : [];
}

function targets({ callee, receiver }: CallSite, owner: CodeSymbol, file: FileFacts, project: Project): Target[] {
  switch (receiver.kind) {
    case 'none': return plainTargets(callee, owner, file, project);
    case 'self': return selfTargets(callee, owner, file, project);
    case 'member': return memberTargets(callee, receiver.object, file, project);
    case 'path': return pathTargets(callee, receiver.path, file, project);
  }
}

export function indexTreeSources(files: SourceFile[], contents: Map<string, string>, grammars: Grammars): StaticIndex {
  const fileSet = new Set(files.map(f => f.path));
  const imports: FileImport[] = [];
  const facts: FileFacts[] = [];
  const globalTypes = new Map<string, string>();
  for (const file of files) {
    const adapter = adapterFor(file.path);
    if (!adapter) continue;
    const extracted = grammars.withTree(adapter.language, contents.get(file.path) ?? '', root => adapter.extract(root, file));
    facts.push({ adapter, symbols: extracted.symbols, calls: extracted.calls, bindings: resolveBindings({ adapter, path: file.path, imports: extracted.imports }, fileSet, imports) });
    if (extracted.globalType) globalTypes.set(`${adapter.language}:${extracted.globalType}`, file.path);
  }
  const project: Project = { byId: new Map(), byName: new Map(), globalTypes };
  for (const { adapter, symbols } of facts) {
    for (const symbol of symbols) {
      project.byId.set(symbol.id, symbol);
      if (symbol.kind === 'function') addName(project, nameKey(adapter, 'function', symbol.name), symbol);
      if (symbol.kind === 'method') addName(project, nameKey(adapter, 'qualified', symbol.name), symbol);
    }
  }
  const edges: StaticEdge[] = facts.flatMap(file => file.calls.flatMap(call =>
    targets(call, project.byId.get(call.from)!, file, project)
      .map(([to, resolution]): StaticEdge => ({ provenance: 'static', from: call.from, to, kind: 'call', resolution, site: call.site }))));
  return { symbols: [...project.byId.values()], edges, imports };
}
