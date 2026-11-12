// Static TypeScript/JavaScript index: symbols, file imports and call sites with exact spans.
// Parses only; never executes code or resolves packages. Every edge is a *possible* call.
import ts from 'typescript';
import { collectSymbols, isCodeFile, parse, spanOf, type FoundSymbol } from './symbols.ts';
import type { CodeSymbol, EdgeResolution, SourceFile, StaticEdge } from './schema.ts';

export const INDEXER_VERSION = `ts-index/1 typescript/${ts.version}`;

export interface FileImport { from: string; to: string; names: string[] }
export interface StaticIndex { symbols: CodeSymbol[]; edges: StaticEdge[]; imports: FileImport[] }

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '/index.ts', '/index.js'];

/** Resolve a relative specifier against the imported file set; bare package names stay unresolved. */
function joinRelative(fromFile: string, spec: string): string | null {
  const parts = fromFile.split('/').slice(0, -1);
  for (const piece of spec.split('/')) {
    if (piece === '..') { if (!parts.length) return null; parts.pop(); }
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

export function resolveSpecifier(fromFile: string, spec: string, files: Set<string>): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const base = joinRelative(fromFile, spec);
  if (base === null) return null;
  const swapped = base.replace(/\.(m?)js$/, '.$1ts');
  const candidates = [...new Set([swapped, base])].flatMap(stem => CANDIDATE_SUFFIXES.map(suffix => stem + suffix));
  return candidates.find(c => files.has(c)) ?? null;
}

interface Binding { file: string; name: string | null }  // name null = namespace import

/** [local name, imported name | null for a namespace] pairs of one import clause. */
function clauseBindings(clause: ts.ImportClause | undefined): [string, string | null][] {
  const out: [string, string | null][] = [];
  if (clause?.name) out.push([clause.name.text, 'default']);
  const named = clause?.namedBindings;
  if (named && ts.isNamespaceImport(named)) out.push([named.name.text, null]);
  else if (named) for (const el of named.elements) out.push([el.name.text, (el.propertyName ?? el.name).text]);
  return out;
}

function importBindings(sf: ts.SourceFile, files: Set<string>, imports: FileImport[]): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const target = resolveSpecifier(sf.fileName, stmt.moduleSpecifier.text, files);
    if (!target) continue;
    const names: string[] = [];
    for (const [local, name] of clauseBindings(stmt.importClause)) {
      bindings.set(local, { file: target, name });
      names.push(name ?? '*');
    }
    imports.push({ from: sf.fileName, to: target, names });
  }
  return bindings;
}

interface FileCtx { sf: ts.SourceFile; local: Map<string, CodeSymbol>; bindings: Map<string, Binding> }
interface Project { byId: Map<string, CodeSymbol>; methodsByName: Map<string, CodeSymbol[]> }

type Target = [string, EdgeResolution];
const known = (project: Project, id: string | null, how: EdgeResolution): Target[] => (id && project.byId.has(id) ? [[id, how]] : []);

function identifierTargets(name: string, file: FileCtx, project: Project): Target[] {
  const local = file.local.get(name);
  if (local && local.kind !== 'class') return [[local.id, 'local']];
  const b = file.bindings.get(name);
  return known(project, b?.name ? `${b.file}#${b.name}` : null, 'import');
}

function memberTargets(callee: ts.PropertyAccessExpression, owner: CodeSymbol, file: FileCtx, project: Project): Target[] {
  const member = callee.name.text;
  if (callee.expression.kind === ts.SyntaxKind.ThisKeyword && owner.kind === 'method') {
    const own = known(project, `${owner.span.file}#${owner.name.split('.')[0]}.${member}`, 'this-member');
    if (own.length) return own;
  }
  const ns = ts.isIdentifier(callee.expression) ? file.bindings.get(callee.expression.text) : undefined;
  if (ns && ns.name === null) return known(project, `${ns.file}#${member}`, 'import');
  return (project.methodsByName.get(member) ?? []).map((m): Target => [m.id, 'name-match']);
}

function targets(callee: ts.Expression, owner: CodeSymbol, file: FileCtx, project: Project): Target[] {
  if (ts.isIdentifier(callee)) return identifierTargets(callee.text, file, project);
  return ts.isPropertyAccessExpression(callee) ? memberTargets(callee, owner, file, project) : [];
}

function callEdges(found: FoundSymbol, file: FileCtx, project: Project): StaticEdge[] {
  const edges: StaticEdge[] = [];
  const owner = found.symbol;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const [to, resolution] of targets(node.expression, owner, file, project)) {
        edges.push({ provenance: 'static', from: owner.id, to, kind: 'call', resolution, site: spanOf(file.sf, node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  if (found.body) visit(found.body);
  return edges;
}

export function indexSources(files: SourceFile[], contents: Map<string, string>): StaticIndex {
  const codeFiles = files.filter(f => isCodeFile(f.path));
  const fileSet = new Set(codeFiles.map(f => f.path));
  const parsed = codeFiles.map(f => {
    const sf = parse(f.path, contents.get(f.path) ?? '');
    return { sf, found: collectSymbols(sf, f.hash) };
  });
  const project: Project = { byId: new Map(), methodsByName: new Map() };
  for (const { found } of parsed) {
    for (const { symbol } of found) {
      project.byId.set(symbol.id, symbol);
      if (symbol.kind === 'method') {
        const short = symbol.name.split('.').pop()!;
        project.methodsByName.set(short, [...(project.methodsByName.get(short) ?? []), symbol]);
      }
    }
  }
  const imports: FileImport[] = [];
  const edges: StaticEdge[] = [];
  for (const { sf, found } of parsed) {
    const local = new Map(found.filter(f => f.symbol.kind !== 'method').map(f => [f.symbol.name, f.symbol]));
    const file: FileCtx = { sf, local, bindings: importBindings(sf, fileSet, imports) };
    for (const f of found) edges.push(...callEdges(f, file, project));
  }
  return { symbols: [...project.byId.values()], edges, imports };
}
