// Allowlisting, sandboxed runs (executed by the Studio server, never here) and navigation from evidence to source.
import * as vscode from 'vscode';
import type { Span } from './answer.ts';
import { command, requireRoot, rootPath, type Ctx } from './context.ts';
import { callerGroups, canAllowlist, shortName, symbolAt } from './evidence.ts';
import { argsValidationMessage, parseArgsJson } from './input.ts';
import { relativeFile } from './staleness.ts';

async function allowlistAtCursor(ctx: Ctx): Promise<void> {
  const { client, projectId } = ctx.session.project();
  const editor = vscode.window.activeTextEditor;
  const root = rootPath();
  const file = editor && root ? relativeFile(root, editor.document.uri.fsPath) : null;
  if (!editor || !file) throw new Error('Place the cursor inside a function of this workspace.');
  const symbol = symbolAt(ctx.session.graph?.symbols ?? [], file, editor.selection.active.line + 1);
  if (!symbol) throw new Error('No indexed function at the cursor (refresh the index if the file changed).');
  if (!canAllowlist(symbol)) throw new Error(`${symbol.name} is not an exported function, so it cannot be an entry.`);
  await client.addEntry(projectId, symbol.id);
  void vscode.window.showInformationMessage(`Mind Meld: ${symbol.name} allowlisted; it runs only in the Studio sandbox.`);
}

async function runEntry(ctx: Ctx): Promise<void> {
  const { client, projectId } = ctx.session.project();
  const sandbox = ctx.session.status?.sandbox;
  if (sandbox && !sandbox.available) throw new Error(`sandbox unavailable — ${sandbox.reason}`);
  const entries = await client.entries(projectId);
  if (!entries.length) throw new Error('No allowlisted entries: use "Allowlist Function at Cursor" first.');
  const picked = await vscode.window.showQuickPick(entries.map(e => ({ label: shortName(e.symbolId), description: e.symbolId, entry: e })), { placeHolder: 'Entry to run in the sandbox' });
  if (!picked) return;
  const typed = await vscode.window.showInputBox({ prompt: `JSON array of arguments for ${picked.label}`, value: '[]', validateInput: argsValidationMessage, ignoreFocusOut: true });
  const args = typed === undefined ? null : parseArgsJson(typed);
  if (!args?.ok) return;
  const { run, events } = await client.execute(projectId, picked.entry.id, args.value);
  await ctx.session.reload();
  const detail = run.error ? `: ${run.error}` : '';
  void vscode.window.showInformationMessage(`Mind Meld: run ${run.status}, ${events.length} observed events${detail}.`);
}

async function revealEvent(ctx: Ctx, runId: string, seq: number): Promise<void> {
  const events = await ctx.session.runEvents(runId);
  const event = events.find(e => e.seq === seq);
  const symbol = event && ctx.session.graph?.symbols.find(s => s.id === event.symbol);
  if (!event || !symbol) throw new Error('This event\'s symbol is not in the current index.');
  const run = ctx.session.runs.find(r => r.id === runId);
  const stale = run?.stale ? ' — STALE: source changed since this run' : '';
  await ctx.revealer.reveal(requireRoot(), symbol.span, `observed call #${seq} ${event.symbol}${stale}\nargs: ${event.args}\n${event.threw ? 'threw' : 'returned'}: ${event.result}`);
}

async function showCallers(ctx: Ctx, symbolId: string): Promise<void> {
  const graph = ctx.session.graph;
  if (!graph) return;
  const { observed, staticOnly } = callerGroups(graph, symbolId);
  const items = [
    ...observed.map(e => ({ label: shortName(e.from), description: `observed ${e.count}× in ${e.runIds.length} fresh run(s)`, id: e.from })),
    ...staticOnly.map(e => ({ label: shortName(e.from), description: `static (possible, ${e.resolution})`, id: e.from })),
  ];
  if (!items.length) { void vscode.window.showInformationMessage(`Mind Meld: no callers of ${shortName(symbolId)} found.`); return; }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: `Callers of ${shortName(symbolId)}` });
  const target = picked && graph.symbols.find(s => s.id === picked.id);
  if (target) await ctx.revealer.reveal(requireRoot(), target.span);
}

export function registerRunCommands(ctx: Ctx): void {
  command(ctx, 'mindmeld.allowlistAtCursor', () => allowlistAtCursor(ctx));
  command(ctx, 'mindmeld.runEntry', () => runEntry(ctx));
  command(ctx, 'mindmeld.revealEvent', (runId, seq) => revealEvent(ctx, runId as string, seq as number));
  command(ctx, 'mindmeld.showCallers', symbolId => showCallers(ctx, symbolId as string));
  command(ctx, 'mindmeld.openSpan', span => ctx.revealer.reveal(requireRoot(), span as Span));
}
