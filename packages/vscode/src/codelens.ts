// CodeLens above each indexed symbol: observed vs static-only evidence. When the open document no longer
// matches the indexed file hash, a single "index stale — refresh" lens replaces them (spans may have moved).
import * as vscode from 'vscode';
import { evidenceFor, lensTitle, STALE_LENS_TITLE } from './evidence.ts';
import type { Session } from './session.ts';
import { fileFreshness, relativeFile } from './staleness.ts';

export const SHOW_CALLERS = 'mindmeld.showCallers';
export const REFRESH = 'mindmeld.refresh';

export class EvidenceLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly session: Session;
  private readonly root: () => string | undefined;

  constructor(session: Session, root: () => string | undefined) { this.session = session; this.root = root; }

  refresh(): void { this.emitter.fire(); }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const graph = this.session.graph;
    const root = this.root();
    const file = root ? relativeFile(root, document.uri.fsPath) : null;
    if (!graph || !file) return [];
    const freshness = fileFreshness(graph.snapshot, file, document.getText());
    if (freshness === 'unindexed') return [];
    if (freshness === 'stale') {
      return [new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title: STALE_LENS_TITLE, command: REFRESH, tooltip: 'This file changed since it was indexed; evidence below may be out of date.' })];
    }
    return graph.symbols.filter(s => s.span.file === file).map(s => {
      const line = s.span.startLine - 1;
      return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
        title: lensTitle(evidenceFor(graph, this.session.runs, s.id)), command: SHOW_CALLERS, arguments: [s.id],
        tooltip: 'Observed = recorded in fresh sandboxed runs; static = possible calls found by the indexer.',
      });
    });
  }
}
