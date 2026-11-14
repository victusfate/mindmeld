// Entry point: wires the Session (all Studio API access) to views, CodeLens, the status bar and commands.
// The extension only calls the Studio API; it never executes repository code itself.
import * as vscode from 'vscode';
import { registerAskCommands } from './askCommands.ts';
import { EvidenceLensProvider } from './codelens.ts';
import { connectEmbedded, registerConnectionCommands, restoreConnection } from './connectionCommands.ts';
import { CONFIG, rootPath, type Ctx } from './context.ts';
import { SpanRevealer } from './editor.ts';
import type { LocalBackend } from '@mindmeld/server';
import { startEmbedded } from './embedded.ts';
import { registerRunCommands } from './runCommands.ts';
import { Session } from './session.ts';
import { StatusBar } from './statusBar.ts';
import { RunsProvider, SymbolsProvider } from './views.ts';

export interface ExtensionApi { session: Session; ready: Promise<void> }

/** VS Code calls deactivate() without a context, so the embedded backend it must close lives here. It is held as
 * the start promise, so a deactivate that arrives while the backend is still starting waits for it and closes it. */
let embedded: Promise<LocalBackend> | null = null;

const usesExternalBackend = (): boolean => vscode.workspace.getConfiguration(CONFIG).get<string>('backend') === 'external';

async function startBackend(ctx: Ctx): Promise<void> {
  const starting = startEmbedded(ctx.context.globalStorageUri.fsPath, ctx.context.extensionPath);
  embedded = starting;
  const backend = await starting;
  if (embedded === starting) await connectEmbedded(ctx, backend);   // else deactivated meanwhile: deactivate closes it
}

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
  return { session, ready: usesExternalBackend() ? restoreConnection(ctx) : startBackend(ctx).catch(reportStartFailure) };
}

function reportStartFailure(error: unknown): void {
  void vscode.window.showErrorMessage(`Mind Meld: the built-in backend did not start (${(error as Error).message}). Set "mindmeld.backend" to "external" to use a separate server.`);
}

/** Subscriptions are disposed by VS Code; the embedded backend is closed here so its database is released cleanly. */
export async function deactivate(): Promise<void> {
  const starting = embedded;
  embedded = null;
  const backend = await starting?.catch(() => null);
  await backend?.close();
}
