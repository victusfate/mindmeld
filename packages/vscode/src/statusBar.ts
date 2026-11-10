// Status bar item: connection, sandbox and model availability (with the reasons), plus total model cost.
import * as vscode from 'vscode';
import { statusView } from './input.ts';
import type { Session } from './session.ts';

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly session: Session;

  constructor(session: Session) {
    this.session = session;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    this.item.command = 'mindmeld.showUsage';
    this.item.show();
  }

  update(): void {
    const view = statusView(this.session.status, this.session.usage);
    this.item.text = view.text;
    this.item.tooltip = view.tooltip;
    this.item.command = this.session.status ? 'mindmeld.showUsage' : 'mindmeld.connect';
  }

  dispose(): void { this.item.dispose(); }
}
