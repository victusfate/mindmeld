// Integration: activate() against the fake `vscode` module and a real in-process Studio server (host-process
// sandbox and scripted model from core's test helpers). Steps share one server and run in order.
import './vscode-hook.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, Studio } from '@mindmeld/core';
import { LocalDirectorySource } from '@mindmeld/connectors';
import { startServer } from '@mindmeld/server';
import { HostProcessSandbox, ScriptedModel, copyFixture } from '../../core/test/helpers.ts';
import { fake, fakeContext, Position, Selection, Uri, type TreeItem } from './fake-vscode.ts';

const { activate } = await import('../src/extension.ts');

const model = new ScriptedModel(() => 'playTurn calls attack and then saves the defender [S:src/game.ts#playTurn]. It also mines bitcoin [S:src/miner.ts#mine]. It is fast.');
const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model, sources: [new LocalDirectorySource()] });
const srv = await startServer({ studio });
after(() => srv.close());

const dir = realpathSync(copyFixture());
fake.folder = Uri.file(dir);
const context = fakeContext();
const api = activate(context as never);
await api.ready;

const run = (id: string, ...args: unknown[]) => fake.commands.get(id)!(...args) as Promise<unknown>;
const errors = () => fake.messages.filter(m => m.level === 'error').map(m => m.text);
const runsTree = () => fake.trees.get('mindmeld.runs')!;
const openDoc = async (file: string) => (await import('./fake-vscode.ts')).workspace.openTextDocument(Uri.file(join(dir, file)));

async function lensTitles(file: string): Promise<Map<number, string>> {
  const lenses = fake.lensProviders[0].provideCodeLenses(await openDoc(file));
  return new Map(lenses.map(l => [l.range.start.line + 1, l.command!.title]));
}
const lineOf = (id: string) => api.session.graph!.symbols.find(s => s.id === id)!.span.startLine;

test('connect accepts a pasted login URL and keeps the token only in secret storage', async () => {
  fake.inputs.push(`${srv.url}/auth?token=${srv.token}`);
  await run('mindmeld.connect');
  assert.deepEqual(errors(), []);
  assert.equal(context.secretValues.get('mindmeld.token'), srv.token);
  assert.ok(![...fake.config.values()].some(v => String(v).includes(srv.token)));
  assert.match(fake.statusBar.text, /sandbox/);
  assert.match(String(fake.statusBar.tooltip), /model scripted-1: available/);
});

test('import the workspace, then re-import matches the existing project by root', async () => {
  await run('mindmeld.importWorkspace');
  await run('mindmeld.importWorkspace');
  assert.deepEqual(errors(), []);
  assert.ok(api.session.graph!.symbols.some(s => s.id === 'src/game.ts#playTurn'));
  assert.equal(studio.store.listProjects().length, 1);
  assert.equal(context.workspaceState.get('mindmeld.projectId'), api.session.projectId);
});

test('allowlist playTurn at the cursor, run it, and see the run with its call tree', async () => {
  const { window } = await import('./fake-vscode.ts');
  const editor = await window.showTextDocument(await openDoc('src/game.ts'));
  const at = new Position(lineOf('src/game.ts#playTurn'), 0);
  editor.selection = new Selection(at, at);
  await run('mindmeld.allowlistAtCursor');
  fake.picks.push(items => items.find(i => i.label === 'playTurn'), items => items[0]);
  fake.inputs.push('{"not":"an array"}');
  await run('mindmeld.runEntry');
  assert.match(String(fake.validation.at(-1)), /JSON array/);
  fake.inputs.push(JSON.stringify([{ name: 'a', hp: 5, attack: 4, armor: 0 }, { name: 'b', hp: 9, attack: 1, armor: 1 }]));
  await run('mindmeld.runEntry');
  assert.deepEqual(errors(), []);
  const roots = await runsTree().getChildren() as unknown[];
  assert.equal(roots.length, 1);
  assert.equal(runsTree().getTreeItem(roots[0]).label, 'playTurn — ok');
  const events = await runsTree().getChildren(roots[0]) as unknown[];
  const top: TreeItem = runsTree().getTreeItem(events[0]);
  assert.match(top.label, /^playTurn\(/);
  assert.match(String(top.description), /observed/);
  const nested = (await runsTree().getChildren(events[0]) as unknown[]).map(n => runsTree().getTreeItem(n).label);
  assert.ok(nested.some(l => l.startsWith('attack(')), nested.join());
  await run(top.command!.command, ...top.command!.arguments!);
  assert.match(String(fake.activeEditor!.decorations[0].hoverMessage), /observed call #0 src\/game.ts#playTurn/);
});

test('CodeLens: attack is observed; legacyCritical is static only', async () => {
  const titles = await lensTitles('src/combat.ts');
  assert.match(titles.get(lineOf('src/combat.ts#attack'))!, /^observed \d+× in 1 fresh run · 1 static caller \(possible\)$/);
  assert.match(titles.get(lineOf('src/combat.ts#legacyCritical'))!, /^no observed calls \(static only\) · 1 static caller \(possible\)$/);
});

test('ask: the answer flags unsupported sentences, shows usage and reveals citations', async () => {
  fake.inputs.push('What does playTurn do when attacking?');
  await run('mindmeld.ask');
  assert.deepEqual(errors(), []);
  const panel = fake.panels.at(-1)!;
  assert.match(panel.webview.html, /class="supported">playTurn calls attack/);
  assert.match(panel.webview.html, /class="unsupported"><span class="badge unsupported">unsupported<\/span> <s>It also mines bitcoin/);
  assert.match(panel.webview.html, /\(unresolvable\)/);
  assert.match(panel.webview.html, /usage: model scripted-1 · tokens in 100 out 20 · cache r\/w unknown\/unknown · cost \$0\.0010/);
  panel.post({ type: 'cite', token: 'S:src/game.ts#playTurn' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(fake.activeEditor!.document.uri.fsPath.endsWith('src/game.ts'));
  assert.match(String(fake.statusBar.tooltip), /total model cost \$0\.0010 · tokens in 100 out 20/);
  assert.match(String(fake.statusBar.tooltip), /last 7d: \d+ ops · tokens in 100 out 20/);
  assert.match(fake.statusBar.text, /5h in 100 out 20/);
});

test('Show Usage reports the model group and copies to the clipboard; Export Usage writes JSONL', async () => {
  fake.messageChoice = 'Copy to clipboard';
  const text = await run('mindmeld.showUsage') as string;
  assert.match(text, /- model scripted \(scripted-1\): 1× .* tokens in 100 out 20/);
  assert.match(text, /Tokens: in 100 · out 20/);
  assert.match(text, /Last 5h: .*tokens in 100 out 20/);
  assert.match(text, /Last 7d: /);
  assert.match(text, /Recent:/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.clipboard, text);
  const out = join(mkdtempSync(join(tmpdir(), 'mm-vscode-')), 'usage.jsonl');
  fake.saveTarget = Uri.file(out);
  await run('mindmeld.exportUsage');
  const kinds = readFileSync(out, 'utf8').trim().split('\n').map(l => (JSON.parse(l) as { kind: string }).kind);
  assert.ok(kinds.includes('model') && kinds.includes('run'), kinds.join());
});

test('Open Studio passes the login URL only to the browser; Export Bundle saves JSON', async () => {
  await run('mindmeld.openStudio');
  assert.match(fake.opened.at(-1)!, /\/auth\?token=/);
  const out = join(mkdtempSync(join(tmpdir(), 'mm-vscode-')), 'bundle.json');
  fake.saveTarget = Uri.file(out);
  await run('mindmeld.exportBundle');
  assert.ok(readFileSync(out, 'utf8').length > 0);
  assert.ok(!fake.messages.some(m => m.text.includes(srv.token)));
});

test('editing a file marks the lens stale; after refresh the run is shown as stale', async () => {
  appendFileSync(join(dir, 'src/combat.ts'), '\n// edited\n');
  assert.deepEqual([...(await lensTitles('src/combat.ts')).values()], ['index stale — refresh']);
  await run('mindmeld.refresh');
  assert.deepEqual(errors(), []);
  const [root] = await runsTree().getChildren() as unknown[];
  const item = runsTree().getTreeItem(root);
  assert.match(String(item.description), /^STALE/);
  assert.match(String(item.tooltip), /stale — source changed since this run: src\/combat.ts/);
  assert.match((await lensTitles('src/combat.ts')).get(lineOf('src/combat.ts#attack'))!, /^no observed calls \(static only\)/);
});
