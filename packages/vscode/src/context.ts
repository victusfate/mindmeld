// Shared state handed to every command module, plus the workspace-root and token helpers they use.
import { realpathSync } from 'node:fs';
import * as vscode from 'vscode';
import type { SpanRevealer } from './editor.ts';
import type { Session } from './session.ts';
import { redactUrl } from './login.ts';

export const TOKEN_SECRET = 'mindmeld.token';
export const PROJECT_KEY = 'mindmeld.projectId';
export const CONFIG = 'mindmeld';

export interface Ctx {
  context: vscode.ExtensionContext;
  session: Session;
  revealer: SpanRevealer;
}

export const rootUri = (): vscode.Uri | undefined => vscode.workspace.workspaceFolders?.[0]?.uri;

/** The workspace root as the server stores it (realpath), so an existing project matches by root. */
export function rootPath(): string | undefined {
  const uri = rootUri();
  if (!uri) return undefined;
  try { return realpathSync(uri.fsPath); } catch { return uri.fsPath; }
}

export function requireRoot(): vscode.Uri {
  const uri = rootUri();
  if (!uri) throw new Error('Open a folder first: Mind Meld works on the current workspace folder.');
  return uri;
}

export const serverUrl = (): string => vscode.workspace.getConfiguration(CONFIG).get<string>('serverUrl') ?? 'http://127.0.0.1:8787';

/** Registers a command whose failures surface as an error message; the message never includes a token. */
export function command(ctx: Ctx, id: string, handler: (...args: unknown[]) => Promise<unknown>): void {
  ctx.context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: unknown[]) => {
    try { return await handler(...args); } catch (e) {
      void vscode.window.showErrorMessage(`Mind Meld: ${redactUrl((e as Error).message)}`);
      return undefined;
    }
  }));
}

/** Writes text the user chose to save (bundle, usage export) through the workspace file system. */
export async function saveText(defaultName: string, filters: Record<string, string[]>, text: string): Promise<vscode.Uri | undefined> {
  const target = await vscode.window.showSaveDialog({ defaultUri: rootUri() ? vscode.Uri.joinPath(rootUri()!, defaultName) : undefined, filters });
  if (!target) return undefined;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  return target;
}
