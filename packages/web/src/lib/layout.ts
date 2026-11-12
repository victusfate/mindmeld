// Layered auto-layout for the symbol map: callers to the left, callees to the right. A symbol's layer is the
// longest call chain reaching it from a root (cycle-safe); within a layer symbols are grouped by file.
import type { CodeSymbol } from '@mindmeld/client';

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 92;
const FILE_GAP = 22;
export { COLUMN_WIDTH, ROW_HEIGHT, FILE_GAP };

export interface Point { x: number; y: number }
export interface Link { from: string; to: string }

function adjacency(ids: Set<string>, links: Link[]): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const { from, to } of links) {
    if (from === to || !ids.has(from) || !ids.has(to)) continue;
    const list = next.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    next.set(from, list);
  }
  return next;
}

/** Longest-path layering over a DFS spanning order; back edges (cycles) are ignored. */
export function layers(ids: string[], links: Link[]): Map<string, number> {
  const idSet = new Set(ids);
  const next = adjacency(idSet, links);
  const layer = new Map<string, number>(ids.map(id => [id, 0]));
  const onStack = new Set<string>();
  const reached = new Set<string>();
  const visit = (id: string, depth: number): void => {
    if (onStack.has(id) || (reached.has(id) && (layer.get(id) ?? 0) >= depth)) return;
    reached.add(id);
    layer.set(id, depth);
    onStack.add(id);
    for (const to of next.get(id) ?? []) visit(to, depth + 1);
    onStack.delete(id);
  };
  const hasCaller = new Set(links.filter(l => l.from !== l.to && idSet.has(l.from)).map(l => l.to));
  for (const id of ids) if (!hasCaller.has(id)) visit(id, 0);
  for (const id of ids) if (!reached.has(id)) visit(id, 0);   // components that are pure cycles
  return layer;
}

const byFileThenLine = (a: CodeSymbol, b: CodeSymbol): number =>
  a.span.file.localeCompare(b.span.file) || a.span.startLine - b.span.startLine;

/** Positions for every symbol: one column per layer, rows grouped by file with a gap between files. */
export function layoutSymbols(symbols: CodeSymbol[], links: Link[]): Map<string, Point> {
  const layerOf = layers(symbols.map(s => s.id), links);
  const columns = new Map<number, CodeSymbol[]>();
  for (const s of symbols) {
    const col = layerOf.get(s.id) ?? 0;
    columns.set(col, [...(columns.get(col) ?? []), s]);
  }
  const out = new Map<string, Point>();
  for (const [col, members] of columns) {
    let y = 0;
    let lastFile = '';
    for (const s of members.sort(byFileThenLine)) {
      if (lastFile && s.span.file !== lastFile) y += FILE_GAP;
      out.set(s.id, { x: col * COLUMN_WIDTH, y });
      y += ROW_HEIGHT;
      lastFile = s.span.file;
    }
  }
  return out;
}

/** Stable palette slot per file, in path order, so a file keeps its colour across reloads. */
export function fileSlots(symbols: CodeSymbol[], slots: number): Map<string, number> {
  const files = [...new Set(symbols.map(s => s.span.file))].sort();
  return new Map(files.map((f, i) => [f, i % slots]));
}
