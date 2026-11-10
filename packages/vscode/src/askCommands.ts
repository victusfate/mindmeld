// Questions and usage sharing. Answers come from the server's local agent CLI and are rendered with only
// resolvable citations as evidence; the usage report and JSONL export let the user share costs back.
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Answer } from '@mindmeld/client';
import { answerHtml, citationTarget } from './answer.ts';
import { command, requireRoot, saveText, type Ctx } from './context.ts';
import { usageReport } from './usage.ts';

const NONCE_BYTES = 16;
const TITLE_CHARS = 40;
export const COPY_ACTION = 'Copy to clipboard';

async function onCitation(ctx: Ctx, answer: Answer, token: string): Promise<void> {
  const target = citationTarget(answer, token);
  if (!target) { void vscode.window.showWarningMessage(`Mind Meld: citation ${token} does not resolve.`); return; }
  const stale = target.freshness === 'stale' ? ' — STALE: source changed since this evidence' : '';
  await ctx.revealer.reveal(requireRoot(), target.span, `${token.startsWith('E:') ? 'observed event' : 'static source'}: ${target.label}${stale}`);
}

function showAnswer(ctx: Ctx, answer: Answer): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel('mindmeld.answer', `Mind Meld: ${answer.question.slice(0, TITLE_CHARS)}`, vscode.ViewColumn.Beside, { enableScripts: true });
  panel.webview.html = answerHtml(answer, randomBytes(NONCE_BYTES).toString('hex'), panel.webview.cspSource);
  panel.webview.onDidReceiveMessage((m: { type?: string; token?: string }) => {
    if (m.type === 'cite' && typeof m.token === 'string') void onCitation(ctx, answer, m.token);
  }, undefined, ctx.context.subscriptions);
  return panel;
}

async function ask(ctx: Ctx): Promise<Answer | undefined> {
  const { client, projectId } = ctx.session.project();
  const model = ctx.session.status?.model;
  if (model && !model.available) throw new Error(`model unavailable — ${model.reason}`);
  const question = await vscode.window.showInputBox({ prompt: 'Ask about this codebase (answers cite static source or observed events, or say unknown)', ignoreFocusOut: true });
  if (!question?.trim()) return undefined;
  const answer = await client.ask(projectId, question.trim());
  showAnswer(ctx, answer);
  await ctx.session.loadUsage();
  ctx.session.notify();
  return answer;
}

async function showUsage(ctx: Ctx): Promise<string> {
  const summary = await ctx.session.connected().usage();
  const text = usageReport(summary);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' }), { preview: true });
  void vscode.window.showInformationMessage('Mind Meld usage report', COPY_ACTION).then(async choice => {
    if (choice === COPY_ACTION) await vscode.env.clipboard.writeText(text);
  });
  return text;
}

async function exportUsage(ctx: Ctx): Promise<void> {
  const records = await ctx.session.connected().usageExport();
  const saved = await saveText('mindmeld-usage.jsonl', { 'JSON Lines': ['jsonl'] }, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  if (saved) void vscode.window.showInformationMessage(`Mind Meld: ${records.length} usage records saved to ${saved.fsPath}`);
}

export function registerAskCommands(ctx: Ctx): void {
  command(ctx, 'mindmeld.ask', () => ask(ctx));
  command(ctx, 'mindmeld.showUsage', () => showUsage(ctx));
  command(ctx, 'mindmeld.exportUsage', () => exportUsage(ctx));
}
