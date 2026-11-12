// Entry point: wires the Session (all Studio API access) to views, CodeLens, the status bar and commands.
// The extension only calls the Studio API; it never executes repository code itself.
import * as vscode from 'vscode';
import { registerAskCommands } from './askCommands.ts';
import { EvidenceLensProvider } from './codelens.ts';
import { registerConnectionCommands, restoreConnection } from './connectionCommands.ts';
import { rootPath, type Ctx } from './context.ts';
import { SpanRevealer } from './editor.ts';
import { registerRunCommands } from './runCommands.ts';
import { Session } from './session.ts';
import { StatusBar } from './statusBar.ts';
import { RunsProvider, SymbolsProvider } from './views.ts';

export interface ExtensionApi { session: Session; ready: Promise<void> }

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const session = new Session();
  const revealer = new SpanRevealer();
  const symbols = new SymbolsProvider(session);
  const runs = new RunsProvider(session);
  const lenses = new EvidenceLensProvider(session, rootPath);
  const statusBar = new StatusBar(session);
  context.subscriptions.push(
    revealer, statusBar,
    vscode.window.registerTreeDataProvider('mindmeld.symbols', symbols),
    vscode.window.registerTreeDataProvider('mindmeld.runs', runs),
    vscode.languages.registerCodeLensProvider([{ language: 'typescript' }, { language: 'javascript' }], lenses),
    vscode.workspace.onDidChangeTextDocument(() => lenses.refresh()),
    session.onChange(() => { symbols.refresh(); runs.refresh(); lenses.refresh(); statusBar.update(); }),
  );
  const ctx: Ctx = { context, session, revealer };
  registerConnectionCommands(ctx);
  registerRunCommands(ctx);
  registerAskCommands(ctx);
  statusBar.update();
  return { session, ready: restoreConnection(ctx) };
}

export function deactivate(): void { /* subscriptions are disposed by VS Code */ }
