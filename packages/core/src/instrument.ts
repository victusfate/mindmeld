// Source-to-source instrumentation for sandboxed runs. Each collected symbol's body is wrapped in
// `__mm.span(id, names, values, () => body)`; the ids come from the same walk the indexer uses.
// Output is plain ESM JavaScript laid out under src/ for the in-sandbox harness to import.
import ts from 'typescript';
import { resolveSpecifier } from './indexer.ts';
import { collectSymbols, isCodeFile } from './symbols.ts';

export const RUNTIME_GLOBAL = '__mindmeld';
const f = ts.factory;

/** `src/a.ts` → `src/a.js`; the emitted tree keeps every directory and file stem. */
export function outputPath(path: string): string {
  return path.replace(/\.tsx$/, '.js').replace(/\.jsx$/, '.js').replace(/\.mts$/, '.mjs').replace(/\.cts$/, '.cjs').replace(/\.ts$/, '.js');
}

function paramValues(params: ts.NodeArray<ts.ParameterDeclaration>): { names: ts.Expression; values: ts.Expression } {
  const names = params.map((p, i) => f.createStringLiteral(ts.isIdentifier(p.name) ? p.name.text : `arg${i}`));
  const values = params.map(p => (ts.isIdentifier(p.name) ? f.createIdentifier(p.name.text) : f.createStringLiteral('(destructured)')));
  return { names: f.createArrayLiteralExpression(names), values: f.createArrayLiteralExpression(values) };
}

function spanCall(id: string, fn: ts.SignatureDeclaration, body: ts.ConciseBody, isMethod: boolean): ts.Expression {
  const isAsync = (ts.getModifiers(fn as ts.HasModifiers) ?? []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
  const thunk = f.createArrowFunction(isAsync ? [f.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined,
    undefined, [], undefined, f.createToken(ts.SyntaxKind.EqualsGreaterThanToken), body);
  const { names, values } = paramValues(fn.parameters);
  const self = isMethod ? f.createThis() : f.createIdentifier('undefined');
  return f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('__mm'), 'span'), undefined,
    [f.createStringLiteral(id), names, values, thunk, self]);
}

const wrapBlock = (expr: ts.Expression): ts.Block => f.createBlock([f.createReturnStatement(expr)], true);

/** Relative ESM specifier from one emitted file to another. */
export function relativeOutput(fromFile: string, target: string): string {
  const from = outputPath(fromFile).split('/').slice(0, -1);
  const to = outputPath(target).split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const rel = [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function rewriteSpecifier(node: ts.Node, file: string, files: Set<string>): ts.Node {
  const spec = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : undefined;
  const target = spec && ts.isStringLiteral(spec) ? resolveSpecifier(file, spec.text, files) : null;
  if (!target) return node;
  const literal = f.createStringLiteral(relativeOutput(file, target));
  if (ts.isImportDeclaration(node)) return f.updateImportDeclaration(node, node.modifiers, node.importClause, literal, node.attributes);
  const exp = node as ts.ExportDeclaration;
  return f.updateExportDeclaration(exp, exp.modifiers, exp.isTypeOnly, exp.exportClause, literal, exp.attributes);
}

function instrumentNode(node: ts.Node, id: string): ts.Node {
  if (ts.isFunctionDeclaration(node) && node.body) {
    return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters,
      node.parameters, node.type, wrapBlock(spanCall(id, node, node.body, false)));
  }
  if (ts.isMethodDeclaration(node) && node.body) {
    return f.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken,
      node.typeParameters, node.parameters, node.type, wrapBlock(spanCall(id, node, node.body, true)));
  }
  if (ts.isArrowFunction(node)) {
    return f.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type,
      node.equalsGreaterThanToken, spanCall(id, node, node.body, false));
  }
  if (ts.isFunctionExpression(node)) {
    return f.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters,
      node.parameters, node.type, wrapBlock(spanCall(id, node, node.body, false)));
  }
  return node;
}

function transformer(file: string, files: Set<string>): ts.TransformerFactory<ts.SourceFile> {
  return context => sf => {
    const ids = new Map(collectSymbols(sf, '').filter(s => s.symbol.kind !== 'class').map(s => [s.node, s.symbol.id]));
    const visit = (node: ts.Node): ts.Node => {
      const visited = ts.visitEachChild(node, visit, context);
      const id = ids.get(node);
      return rewriteSpecifier(id ? instrumentNode(visited, id) : visited, file, files);
    };
    return ts.visitNode(sf, visit) as ts.SourceFile;
  };
}

/** Instrument every code file; other files are copied byte-for-byte. Returns output path → content. */
export function instrumentProject(contents: Map<string, string>): Map<string, string> {
  const files = new Set([...contents.keys()].filter(isCodeFile));
  const out = new Map<string, string>();
  for (const [path, source] of contents) {
    if (!files.has(path)) { out.set(path, source); continue; }
    const result = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, allowJs: true, verbatimModuleSyntax: false },
      transformers: { before: [transformer(path, files)] },
    });
    out.set(outputPath(path), `const __mm = globalThis.${RUNTIME_GLOBAL};\n${result.outputText}`);
  }
  return out;
}
