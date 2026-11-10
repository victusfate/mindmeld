import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceStore, Studio, ModelUnavailableError, judgeAnswer, type SourceConnector } from '../src/index.ts';
import { copyFixture, HostProcessSandbox, ScriptedModel } from './helpers.ts';

const local: SourceConnector = { kind: 'local', materialize: root => Promise.resolve({ root, name: 'fixture' }) };

async function setup(model: ScriptedModel | null) {
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model, sources: [local] });
  const { project } = await studio.addProject({ kind: 'local', ref: copyFixture() });
  const entry = studio.addEntry(project.id, 'src/game.ts#playTurn');
  const { run } = await studio.execute(project.id, entry.id, [{ name: 'a', hp: 5, attack: 4, armor: 0 }, { name: 'b', hp: 9, attack: 1, armor: 1 }]);
  return { studio, project, run };
}

test('cited answers are supported; uncited or invented citations are flagged', async () => {
  let runId = '';
  const model = new ScriptedModel(() => `playTurn calls attack and then saves the defender [S:src/game.ts#playTurn]. In the recorded run attack was observed [E:${runId}#1]. It also mines bitcoin [S:src/miner.ts#mine]. It is fast.`);
  const { studio, project, run } = await setup(model);
  runId = run.id;
  const answer = await studio.ask(project.id, 'What does playTurn do when attacking?');
  assert.equal(answer.abstained, false);
  assert.deepEqual(answer.sentences.map(s => s.supported), [true, true, false, false]);
  assert.ok(!answer.text.includes('bitcoin'));
  assert.equal(answer.citations.find(c => c.ref === 'src/miner.ts#mine')?.valid, false);
  const prompt = model.seen[0][1].content;
  assert.match(prompt, /\[S:src\/game\.ts#playTurn\]/);
  assert.match(prompt, new RegExp(`\\[E:${run.id}#0\\]`));
});

test('prompt injection in source cannot produce a supported claim', async () => {
  const model = new ScriptedModel(messages => (messages[1].content.includes('IGNORE ALL PREVIOUS') ? 'playTurn deletes the database.' : 'unknown: nothing relevant.'));
  const { studio, project } = await setup(model);
  const answer = await studio.ask(project.id, 'what does the NOTE in notes say about playTurn and the database?');
  assert.equal(answer.abstained, true);
  assert.match(answer.text, /^unknown/);
  assert.equal(answer.sentences[0].supported, false);
});

test('without a model, Q&A is unavailable but evidence inspection works', async () => {
  const { studio, project } = await setup(null);
  await assert.rejects(studio.ask(project.id, 'what is playTurn?'), ModelUnavailableError);
  assert.ok(studio.graph(project.id).observedEdges.length > 0);
  const offline = new ScriptedModel(() => 'x');
  offline.available = false;
  const s2 = await setup(offline);
  await assert.rejects(s2.studio.ask(s2.project.id, 'what is playTurn?'), ModelUnavailableError);
});

test('unrelated questions abstain without calling the model', async () => {
  const model = new ScriptedModel(() => 'should not be called');
  const { studio, project } = await setup(model);
  const answer = await studio.ask(project.id, 'zzz qqq');
  assert.equal(answer.abstained, true);
  assert.equal(model.seen.length, 0);
});

test('judgeAnswer treats "unknown" sentences as unknowns', () => {
  const a = judgeAnswer('q', 'unknown: the evidence does not show retries.', { symbols: new Map(), runs: new Map(), events: () => [] }, null);
  assert.equal(a.abstained, true);
  assert.deepEqual(a.unknowns, ['unknown: the evidence does not show retries.']);
});

test('usage is recorded per index, run and model call; unknown stays unknown', async () => {
  const model = new ScriptedModel(() => 'playTurn attacks [S:src/game.ts#playTurn].');
  const { studio, project } = await setup(model);
  const answer = await studio.ask(project.id, 'what does playTurn do?');
  assert.deepEqual([answer.usage?.inputTokens, answer.usage?.costUsd], [100, 0.001]);
  const summary = studio.usage(project.id);
  assert.deepEqual(summary.groups.map(g => g.kind).sort(), ['index', 'model', 'run']);
  const m = summary.groups.find(g => g.kind === 'model')!;
  assert.deepEqual([m.count, m.inputTokens, m.outputTokens, m.unknownCost], [1, 100, 20, 0]);
  assert.equal(summary.recent[0].kind, 'model');
  assert.throws(() => studio.store.db.prepare("UPDATE usage SET data = '{}'").run(), /append-only/);
  const { formatUsage } = await import('../src/index.ts');
  assert.match(formatUsage(summary), /model scripted \(scripted-1\): 1×/);
});
