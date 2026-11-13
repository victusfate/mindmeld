// The contract between one tree-sitter language and the shared cross-file resolver (../tree-index.ts).
// An adapter only reads its own file: it reports declarations, call sites and import bindings, never edges.
import type { Node } from 'web-tree-sitter';
import type { GrammarLanguage } from '../grammars.ts';
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

/** `name: null` = the local name is the module itself, so `local.f()` targets `file#f`. */
export interface ResolvedImport { file: string; name: string | null }

export interface Extracted { symbols: CodeSymbol[]; calls: CallSite[]; imports: ImportBinding[] }

export interface LanguageAdapter {
  readonly language: GrammarLanguage;
  readonly extensions: readonly string[];
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

/** Every `callType` node under `body`, with its owner; nested declarations stay attributed to the outer symbol. */
export function callsIn(body: Node | null, callType: string): Node[] {
  return body ? body.descendantsOfType(callType).filter((n): n is Node => n !== null) : [];
}
