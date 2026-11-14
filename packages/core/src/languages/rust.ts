// Rust adapter: top-level fns, structs, enums and traits, methods in `impl` and `trait` blocks, and calls.
// `use` paths are not resolved (module layout needs Cargo's view of the crate), so cross-file calls are name matches
// on `Type::f` or on free functions; method calls on values of unknown type get no edge.
import type { Node } from 'web-tree-sitter';
import type { SourceFile } from '../schema.ts';
import { addCalls, toSymbol, type Extracted, type LanguageAdapter, type Receiver } from './adapter.ts';

const TYPE_ITEMS = new Set(['struct_item', 'enum_item', 'trait_item']);
const isPublic = (node: Node): boolean => node.namedChildren.some(c => c.type === 'visibility_modifier');
const isAsync = (fn: Node): boolean => fn.namedChildren.some(c => c.type === 'function_modifiers' && c.text.split(/\s+/).includes('async'));

function paramNames(params: Node | null): string[] {
  return (params?.namedChildren ?? []).flatMap((p, i) => {
    if (p.type === 'self_parameter') return ['self'];
    if (p.type !== 'parameter') return [];
    const pattern = p.childForFieldName('pattern');
    return [pattern?.type === 'identifier' ? pattern.text : `arg${i}`];
  });
}

/** `Ship`, `Ship<T>` and `crate::Ship` all name the type `Ship`. */
function typeName(node: Node | null): string | null {
  if (!node) return null;
  if (node.type === 'generic_type' || node.type === 'scoped_type_identifier') return typeName(node.childForFieldName('type') ?? node.childForFieldName('name'));
  return node.type === 'type_identifier' ? node.text : null;
}

type Target = { callee: string; receiver: Receiver } | null;

/** `x.f()` / `self.f()`. */
function fieldCall(fn: Node): Target {
  const value = fn.childForFieldName('value');
  const callee = fn.childForFieldName('field')?.text ?? '';
  if (value?.type === 'self') return { callee, receiver: { kind: 'self' } };
  return { callee, receiver: { kind: 'member', object: value?.type === 'identifier' ? value.text : null } };
}

/** `Type::f()` / `module::f()` / `Self::f()`; only the last path segment is kept. */
function pathCall(fn: Node): Target {
  const path = fn.childForFieldName('path')?.text ?? '';
  const callee = fn.childForFieldName('name')?.text ?? '';
  return { callee, receiver: path === 'Self' ? { kind: 'self' } : { kind: 'path', path: path.split('::').pop()! } };
}

function receiverOf(fn: Node): Target {
  switch (fn.type) {
    case 'identifier': return { callee: fn.text, receiver: { kind: 'none' } };
    case 'generic_function': return receiverOf(fn.childForFieldName('function') ?? fn);
    case 'field_expression': return fieldCall(fn);
    case 'scoped_identifier': return pathCall(fn);
    default: return null;
  }
}

function addFunction(out: Extracted, file: SourceFile, fn: Node, owner: { type: string; exported: boolean } | null): void {
  const name = fn.childForFieldName('name')?.text ?? '';
  const symbol = toSymbol(file, {
    node: fn, name: owner ? `${owner.type}.${name}` : name, kind: owner ? 'method' : 'function',
    exported: isPublic(fn) || Boolean(owner?.exported), async: isAsync(fn), params: paramNames(fn.childForFieldName('parameters')),
  });
  out.symbols.push(symbol);
  addCalls(out, symbol, fn.childForFieldName('body'), { types: ['call_expression'], targetOf: call => receiverOf(call.childForFieldName('function') ?? call) });
}

/** Methods of an `impl` (owned by its self type) or a `trait` (exported with the trait). */
function addMethods(out: Extracted, file: SourceFile, block: Node, owner: { type: string; exported: boolean }): void {
  for (const member of block.childForFieldName('body')?.namedChildren ?? []) {
    if (member.type === 'function_item') addFunction(out, file, member, owner);
  }
}

function extract(root: Node, file: SourceFile): Extracted {
  const out: Extracted = { symbols: [], calls: [], imports: [] };
  for (const item of root.namedChildren) {
    const name = item.childForFieldName('name')?.text ?? '';
    if (item.type === 'function_item') addFunction(out, file, item, null);
    else if (TYPE_ITEMS.has(item.type)) {
      out.symbols.push(toSymbol(file, { node: item, name, kind: 'class', exported: isPublic(item), async: false, params: [] }));
      if (item.type === 'trait_item') addMethods(out, file, item, { type: name, exported: isPublic(item) });
    } else if (item.type === 'impl_item') {
      const type = typeName(item.childForFieldName('type'));
      if (type) addMethods(out, file, item, { type, exported: false });
    }
  }
  return out;
}

export const rust: LanguageAdapter = { language: 'rust', extensions: ['.rs'], matchFreeFunctions: true, extract };
