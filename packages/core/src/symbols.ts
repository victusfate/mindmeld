// One symbol walk shared by the indexer and the instrumenter, so a recorded event's symbol id is
// exactly the id the map shows for that declaration.
import ts from 'typescript';
import type { CodeSymbol, Span, SymbolKind } from './schema.ts';

export interface FoundSymbol { node: ts.Node; symbol: CodeSymbol; body: ts.ConciseBody | undefined }

export function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function parse(path: string, content: string): ts.SourceFile {
  return ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
}

export function spanOf(sf: ts.SourceFile, node: ts.Node): Span {
  return {
    file: sf.fileName,
    startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
  };
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(m => m.kind === kind);

function paramNames(params: ts.NodeArray<ts.ParameterDeclaration>): string[] {
  return params.map((p, i) => (ts.isIdentifier(p.name) ? p.name.text : `arg${i}`));
}

interface Ctx { sf: ts.SourceFile; fileHash: string; out: FoundSymbol[] }

type Fn = ts.SignatureDeclaration & { body?: ts.ConciseBody };
interface Decl { node: ts.Node; name: string; kind: SymbolKind; fn: Fn; exported: boolean }

function add(ctx: Ctx, { node, name, kind, fn, exported }: Decl): void {
  ctx.out.push({
    node,
    body: fn.body,
    symbol: {
      id: `${ctx.sf.fileName}#${name}`, name, kind, exported,
      async: hasModifier(fn, ts.SyntaxKind.AsyncKeyword),
      params: paramNames(fn.parameters),
      span: spanOf(ctx.sf, node), fileHash: ctx.fileHash,
    },
  });
}

function collectClass(ctx: Ctx, cls: ts.ClassDeclaration, exported: boolean): void {
  const className = cls.name?.text ?? 'default';
  ctx.out.push({ node: cls, body: undefined, symbol: {
    id: `${ctx.sf.fileName}#${className}`, name: className, kind: 'class', exported, async: false,
    params: [], span: spanOf(ctx.sf, cls), fileHash: ctx.fileHash,
  } });
  for (const member of cls.members) {
    if (ts.isMethodDeclaration(member) && member.body && ts.isIdentifier(member.name) && !member.asteriskToken) {
      add(ctx, { node: member, name: `${className}.${member.name.text}`, kind: 'method', fn: member, exported });
    }
  }
}

function collectVariables(ctx: Ctx, stmt: ts.VariableStatement): void {
  const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
  for (const decl of stmt.declarationList.declarations) {
    const init = decl.initializer;
    if (!ts.isIdentifier(decl.name) || !init) continue;
    if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && !(ts.isFunctionExpression(init) && init.asteriskToken)) {
      add(ctx, { node: init, name: decl.name.text, kind: 'variable-function', fn: init, exported });
    }
  }
}

/** Top-level functions, classes and their methods, and `const f = () => …` declarations. */
export function collectSymbols(sf: ts.SourceFile, fileHash: string): FoundSymbol[] {
  const ctx: Ctx = { sf, fileHash, out: [] };
  for (const stmt of sf.statements) {
    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body && !stmt.asteriskToken) {
      add(ctx, { node: stmt, name: stmt.name.text, kind: 'function', fn: stmt, exported });
    } else if (ts.isClassDeclaration(stmt)) collectClass(ctx, stmt, exported);
    else if (ts.isVariableStatement(stmt)) collectVariables(ctx, stmt);
  }
  return ctx.out;
}

export const isCodeFile = (path: string): boolean => /\.(m|c)?(t|j)sx?$/.test(path) && !path.endsWith('.d.ts');
