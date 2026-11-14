// Python adapter: top-level functions and classes, methods one level inside a class, calls, and imports.
import type { Node } from 'web-tree-sitter';
import type { SourceFile } from '../schema.ts';
import { addCalls, toSymbol, underscorePublic, type Extracted, type ImportBinding, type LanguageAdapter, type Receiver } from './adapter.ts';
import type { ResolvedImport } from '../resolve.ts';

/** A decorated definition wraps the real one; everything else is returned as is. */
const unwrap = (node: Node): Node => (node.type === 'decorated_definition' ? node.childForFieldName('definition') ?? node : node);

function paramNames(params: Node | null): string[] {
  return (params?.namedChildren ?? []).flatMap((p, i) => {
    if (p.type === 'identifier') return [p.text];
    const named = p.childForFieldName('name') ?? p.namedChildren.find(c => c.type === 'identifier');
    return named ? [named.text] : p.type.endsWith('separator') ? [] : [`arg${i}`];
  });
}

function receiverOf(fn: Node): { callee: string; receiver: Receiver } | null {
  if (fn.type === 'identifier') return { callee: fn.text, receiver: { kind: 'none' } };
  if (fn.type !== 'attribute') return null;
  const object = fn.childForFieldName('object');
  const callee = fn.childForFieldName('attribute')?.text;
  if (!callee || !object) return null;
  if (object.type === 'identifier' && object.text === 'self') return { callee, receiver: { kind: 'self' } };
  return { callee, receiver: { kind: 'member', object: object.type === 'identifier' ? object.text : null } };
}

function bindingsOf(stmt: Node): ImportBinding[] {
  const names = stmt.childrenForFieldName('name');
  const split = (n: Node): [string, string] => {
    const name = n.type === 'aliased_import' ? n.childForFieldName('name')?.text ?? '' : n.text;
    return [name, n.type === 'aliased_import' ? n.childForFieldName('alias')?.text ?? name : name];
  };
  if (stmt.type === 'import_statement') {
    return names.map(split).map(([name, local]) => ({ local: local.split('.')[0], module: local === name ? name.split('.')[0] : name, name: null }));
  }
  const module = stmt.childForFieldName('module_name')?.text ?? '';
  return names.map(split).map(([name, local]) => ({ local, module, name }));
}

function addFunction(out: Extracted, file: SourceFile, node: Node, owner: string | null): void {
  const name = node.childForFieldName('name')?.text ?? '';
  const symbol = toSymbol(file, {
    node, name: owner ? `${owner}.${name}` : name, kind: owner ? 'method' : 'function', exported: underscorePublic(name),
    async: node.children[0]?.type === 'async', params: paramNames(node.childForFieldName('parameters')),
  });
  out.symbols.push(symbol);
  addCalls(out, symbol, node.childForFieldName('body'), { types: ['call'], targetOf: call => receiverOf(call.childForFieldName('function') ?? call) });
}

function addClass(out: Extracted, file: SourceFile, node: Node): void {
  const name = node.childForFieldName('name')?.text ?? '';
  out.symbols.push(toSymbol(file, { node, name, kind: 'class', exported: underscorePublic(name), async: false, params: [] }));
  for (const member of (node.childForFieldName('body')?.namedChildren ?? []).map(unwrap)) {
    if (member.type === 'function_definition') addFunction(out, file, member, name);
  }
}

function extract(root: Node, file: SourceFile): Extracted {
  const out: Extracted = { symbols: [], calls: [], imports: [] };
  for (const stmt of root.namedChildren.map(unwrap)) {
    if (stmt.type === 'function_definition') addFunction(out, file, stmt, null);
    else if (stmt.type === 'class_definition') addClass(out, file, stmt);
    else if (stmt.type === 'import_statement' || stmt.type === 'import_from_statement') out.imports.push(...bindingsOf(stmt));
  }
  return out;
}

const parentDir = (path: string): string => path.split('/').slice(0, -1).join('/');
const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');

/** The module file for a dotted path under `dir`: `a/b.py` or `a/b/__init__.py`. */
function moduleFile(dir: string, dotted: string, files: ReadonlySet<string>): string | null {
  const base = joinPath(dir, ...dotted.split('.').filter(Boolean));
  return [`${base}.py`, joinPath(base, '__init__.py')].find(f => files.has(f)) ?? null;
}

/** Relative imports start from the file's package; absolute ones try each enclosing directory, deepest first. */
function searchDirs(fromFile: string, module: string): string[] {
  const dots = /^\.*/.exec(module)![0].length;
  let dir = parentDir(fromFile);
  if (dots) {
    for (let up = 1; up < dots; up++) dir = parentDir(dir);
    return [dir];
  }
  const dirs: string[] = [];
  for (; dir; dir = parentDir(dir)) dirs.push(dir);
  return [...dirs, ''];
}

function resolveImport(fromFile: string, binding: ImportBinding, files: ReadonlySet<string>): ResolvedImport | null {
  const dotted = binding.module.replace(/^\.+/, '');
  for (const dir of searchDirs(fromFile, binding.module)) {
    const submodule = binding.name && moduleFile(dir, joinPath(dotted, binding.name).replaceAll('/', '.'), files);
    if (submodule) return { file: submodule, name: null };
    const file = moduleFile(dir, dotted, files);
    if (file) return { file, name: binding.name };
  }
  return null;
}

export const python: LanguageAdapter = { language: 'python', extensions: ['.py'], extract, resolveImport };
