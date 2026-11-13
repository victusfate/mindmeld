// GDScript adapter: a script's funcs are its own methods, so they are top-level functions here; inner `class`
// blocks add classes and methods. `class_name` globals and `preload` paths are not resolved, so `Helper.f()`
// across files is a name match.
import type { Node } from 'web-tree-sitter';
import type { SourceFile } from '../schema.ts';
import { spanOfNode, toSymbol, type Extracted, type LanguageAdapter, type Receiver } from './adapter.ts';

const isPublic = (name: string): boolean => !name.startsWith('_');
/** By convention class names are capitalized, so `Helper.f()` is a type path while `node.f()` is a member call. */
const looksLikeType = (name: string): boolean => /^[A-Z]/.test(name);

function paramNames(params: Node | null): string[] {
  return (params?.namedChildren ?? []).map((p, i) => (p.type === 'identifier' ? p.text : p.namedChildren.find(c => c.type === 'identifier')?.text ?? `arg${i}`));
}

/** `f()` is a `call`; `x.f()` is an `attribute_call` preceded by its receiver inside an `attribute`. */
function receiverOf(call: Node): { callee: string; receiver: Receiver } | null {
  const callee = call.namedChildren.find(c => c.type === 'identifier')?.text;
  if (!callee) return null;
  if (call.type === 'call') return { callee, receiver: { kind: 'none' } };
  const siblings = call.parent?.namedChildren ?? [];
  const object = siblings[siblings.findIndex(s => s.id === call.id) - 1];
  if (object?.type !== 'identifier') return { callee, receiver: { kind: 'member', object: null } };
  if (object.text === 'self') return { callee, receiver: { kind: 'self' } };
  return { callee, receiver: looksLikeType(object.text) ? { kind: 'path', path: object.text } : { kind: 'member', object: object.text } };
}

function addFunction(out: Extracted, file: SourceFile, fn: Node, owner: string | null): void {
  const name = fn.childForFieldName('name')?.text ?? '';
  const symbol = toSymbol(file, {
    node: fn, name: owner ? `${owner}.${name}` : name, kind: owner ? 'method' : 'function',
    exported: isPublic(name), async: false, params: paramNames(fn.childForFieldName('parameters')),
  });
  out.symbols.push(symbol);
  for (const call of fn.childForFieldName('body')?.descendantsOfType(['call', 'attribute_call']) ?? []) {
    const target = call && receiverOf(call);
    if (target) out.calls.push({ from: symbol.id, ...target, site: spanOfNode(file.path, call) });
  }
}

function extract(root: Node, file: SourceFile): Extracted {
  const out: Extracted = { symbols: [], calls: [], imports: [] };
  for (const stmt of root.namedChildren) {
    if (stmt.type === 'function_definition') addFunction(out, file, stmt, null);
    if (stmt.type !== 'class_definition') continue;
    const name = stmt.childForFieldName('name')?.text ?? '';
    out.symbols.push(toSymbol(file, { node: stmt, name, kind: 'class', exported: isPublic(name), async: false, params: [] }));
    const body = stmt.namedChildren.find(c => c.type === 'class_body');
    for (const member of body?.namedChildren ?? []) if (member.type === 'function_definition') addFunction(out, file, member, name);
  }
  return out;
}

export const gdscript: LanguageAdapter = { language: 'gdscript', extensions: ['.gd'], implicitSelf: true, extract };
