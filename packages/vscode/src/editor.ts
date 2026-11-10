// Opens a source span from the workspace and highlights it; used for symbols, callers, citations and the
// currently replayed event. Only one replay highlight is shown at a time.
import * as vscode from 'vscode';
import type { Span } from './answer.ts';

export class SpanRevealer {
  readonly decoration: vscode.TextEditorDecorationType;
  private last: vscode.TextEditor | null = null;

  constructor() {
    this.decoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
    });
  }

  async reveal(root: vscode.Uri, span: Span, hover?: string): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, span.file));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const range = new vscode.Range(span.startLine - 1, 0, span.endLine - 1, 0);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    if (hover !== undefined) {
      this.last?.setDecorations(this.decoration, []);
      editor.setDecorations(this.decoration, [{ range, hoverMessage: hover }]);
      this.last = editor;
    }
    return editor;
  }

  dispose(): void { this.decoration.dispose(); }
}
