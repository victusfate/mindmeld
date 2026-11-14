// Connect, import, refresh, open-in-browser and bundle export. The token lives only in SecretStorage and is
// never written to settings, logs or messages.
import * as vscode from 'vscode';
import { CONFIG, PROJECT_KEY, TOKEN_SECRET, command, requireRoot, rootPath, saveText, serverUrl, type Ctx } from './context.ts';
import { loginUrl, parseConnectionInput } from './login.ts';

async function askToken(): Promise<string | undefined> {
  return vscode.window.showInputBox({ prompt: 'Mind Meld access token (from the server\'s login URL)', password: true, ignoreFocusOut: true });
}

async function connect(ctx: Ctx): Promise<void> {
  const typed = await vscode.window.showInputBox({
    prompt: 'Paste the login URL the server printed (…/auth?token=…), or the server URL',
    value: serverUrl(), ignoreFocusOut: true,
    validateInput: text => (parseConnectionInput(text) ? null : 'Enter an http(s) URL'),
  });
  const parsed = typed === undefined ? null : parseConnectionInput(typed);
  if (!parsed) return;
  const token = parsed.token ?? await ctx.context.secrets.get(TOKEN_SECRET) ?? await askToken();
  if (!token) return;
  const status = await ctx.session.connect(parsed.baseUrl, token);
  await ctx.context.secrets.store(TOKEN_SECRET, token);
  if (parsed.baseUrl !== serverUrl()) await vscode.workspace.getConfiguration(CONFIG).update('serverUrl', parsed.baseUrl, vscode.ConfigurationTarget.Global);
  await restoreProject(ctx);
  void vscode.window.showInformationMessage(`Mind Meld: connected to ${parsed.baseUrl} (sandbox ${status.sandbox.available ? 'available' : 'unavailable'}, model ${status.model.available ? 'available' : 'unavailable'}).`);
}

async function restoreProject(ctx: Ctx): Promise<void> {
  const remembered = ctx.context.workspaceState.get<string>(PROJECT_KEY);
  if (remembered && !(await ctx.session.useProject(remembered))) await ctx.context.workspaceState.update(PROJECT_KEY, undefined);
}

/** Connects to the backend running in the extension host. Its token is per-start, so it is never stored. */
export async function connectEmbedded(ctx: Ctx, backend: { url: string; token: string }): Promise<void> {
  await ctx.session.connect(backend.url, backend.token);
  await restoreProject(ctx);
}

/** Reconnects silently at startup when a token is stored; stays disconnected (with a status-bar hint) otherwise. */
export async function restoreConnection(ctx: Ctx): Promise<void> {
  const token = await ctx.context.secrets.get(TOKEN_SECRET);
  if (!token) return;
  try {
    await ctx.session.connect(serverUrl(), token);
    await restoreProject(ctx);
  } catch { ctx.session.disconnect(); }
}

async function importWorkspace(ctx: Ctx): Promise<void> {
  requireRoot();
  const project = await ctx.session.importRoot(rootPath()!);
  await ctx.context.workspaceState.update(PROJECT_KEY, project.id);
  const graph = ctx.session.graph;
  void vscode.window.showInformationMessage(`Mind Meld: indexed ${project.name}: ${graph?.symbols.length ?? 0} symbols, ${graph?.staticEdges.length ?? 0} static (possible) edges.`);
}

async function exportBundle(ctx: Ctx): Promise<void> {
  const { client, projectId } = ctx.session.project();
  const bundle = await client.exportBundle(projectId);
  const saved = await saveText('mindmeld-bundle.json', { JSON: ['json'] }, JSON.stringify(bundle, null, 2));
  if (saved) void vscode.window.showInformationMessage(`Mind Meld: bundle saved to ${saved.fsPath}`);
}

async function openStudio(ctx: Ctx): Promise<void> {
  ctx.session.connected();
  const token = ctx.session.token;
  await vscode.env.openExternal(vscode.Uri.parse(token ? loginUrl(ctx.session.baseUrl, token) : ctx.session.baseUrl));
}

export function registerConnectionCommands(ctx: Ctx): void {
  command(ctx, 'mindmeld.connect', () => connect(ctx));
  command(ctx, 'mindmeld.importWorkspace', () => importWorkspace(ctx));
  command(ctx, 'mindmeld.refresh', () => ctx.session.refresh());
  command(ctx, 'mindmeld.openStudio', () => openStudio(ctx));
  command(ctx, 'mindmeld.exportBundle', () => exportBundle(ctx));
}
