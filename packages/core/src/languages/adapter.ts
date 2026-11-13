// The contract between one tree-sitter language and the shared cross-file resolver (../tree-index.ts).
// An adapter only reads its own file: it reports declarations, call sites and import bindings, never edges.
import type { Node } from 'web-tree-sitter';
import type { GrammarLanguage } from '../grammars.ts';
import type { ResolvedImport } from '../resolve.ts';
import type { CodeSymbol, SourceFile, Span, SymbolKind } from '../schema.ts';

/** How a call names its target. `member` covers `x.f()`; `path` covers Rust `Type::f()`. */
export type Receiver =
  | { kind: 'none' }
  | { kind: 'self' }
  | { kind: 'member'; object: string | null }
  | { kind: 'path'; path: string };

export interface CallSite { from: string; callee: string; receiver: Receiver; site: Span }

/** `name: null` binds the whole module (`import m`); `module` is the language's own spelling (e.g. `..pkg.m`). */
export interface ImportBinding { local: string; module: string; name: string | null }

export interface Extracted {
  symbols: CodeSymbol[]; calls: CallSite[]; imports: ImportBinding[];
  /** A name this file registers globally, so `Name.f()` anywhere means this file's `f` (GDScript `class_name`). */
  globalType?: string;
}

export interface LanguageAdapter {
  readonly language: GrammarLanguage;
  readonly extensions: readonly string[];
  /** A bare `f()` may call a method of the enclosing class or script (GDScript), not only a free function. */
  readonly implicitSelf?: boolean;
  /** Unresolved bare and path calls may name-match free functions: true only where imports are not resolved and a
   * bare call cannot mean a builtin or an inherited method (Rust). */
  readonly matchFreeFunctions?: boolean;
  extract(root: Node, file: SourceFile): Extracted;
  /** Maps an import binding to a repo file (and the name it binds there), or null when it is outside the file set. */
  resolveImport?(fromFile: string, binding: ImportBinding, files: ReadonlySet<string>): ResolvedImport | null;
}

export const spanOfNode = (file: string, node: Node): Span =>
  ({ file, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });

export interface Declaration { node: Node; name: string; kind: SymbolKind; exported: boolean; async: boolean; params: string[] }

export function toSymbol(file: SourceFile, d: Declaration): CodeSymbol {
  return {
    id: `${file.path}#${d.name}`, name: d.name, kind: d.kind, exported: d.exported, async: d.async,
    params: d.params, span: spanOfNode(file.path, d.node), fileHash: file.hash,
  };
}

/** Python and GDScript mark private names with a leading underscore. */
export const underscorePublic = (name: string): boolean => !name.startsWith('_');

type CallTarget = Pick<CallSite, 'callee' | 'receiver'> | null;

/** Records the `call.types` nodes under `body` as calls from `owner`; calls inside nested declarations count toward
 * the outer symbol. `targetOf` reads one call node, or returns null for a call it cannot name. */
export function addCalls(out: Extracted, owner: CodeSymbol, body: Node | null, call: { types: string[]; targetOf: (call: Node) => CallTarget }): void {
  for (const node of body?.descendantsOfType(call.types) ?? []) {
    const target = node && call.targetOf(node);
    if (target) out.calls.push({ from: owner.id, ...target, site: spanOfNode(owner.span.file, node) });
  }
}
