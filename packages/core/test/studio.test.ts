import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvidenceStore, Studio, SandboxUnavailableError, ValidationError, type SourceConnector } from '../src/index.ts';
import { copyFixture, HostProcessSandbox } from './helpers.ts';

const local: SourceConnector = { kind: 'local', materialize: root => Promise.resolve({ root, name: 'fixture' }) };
const hero = { name: 'hero', hp: 10, attack: 7, armor: 1 };
const slime = { name: 'slime', hp: 5, attack: 2, armor: 2 };

async function setup() {
  const dir = copyFixture();
  const sandbox = new HostProcessSandbox();
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox, model: null, sources: [local] });
  const { project } = await studio.addProject({ kind: 'local', ref: dir });
  const entry = studio.addEntry(project.id, 'src/game.ts#playTurn');
  return { dir, sandbox, studio, project, entry };
}

test('a real run records observed calls; static-only edges are never observed', async () => {
  const { studio, project, entry } = await setup();
  const { run, events } = await studio.execute(project.id, entry.id, [hero, slime]);
  assert.equal(run.status, 'ok', run.error ?? '');
  assert.deepEqual(JSON.parse(run.output), { defender: { ...slime, hp: 0 }, defeated: true, savedBytes: 44 });
  assert.deepEqual(events.map(e => e.symbol), ['src/game.ts#playTurn', 'src/combat.ts#attack', 'src/damage.ts#computeDamage', 'src/damage.ts#clampHp', 'src/save.ts#MemorySave.write']);
  assert.deepEqual(events.map(e => e.parent), [null, 0, 1, 1, 0]);
  const write = events[4];
  assert.match(write.thisAfter ?? '', /slime/);   // the receiver mutation is recorded
  const graph = studio.graph(project.id);
  const observed = graph.observedEdges.map(e => `${e.from}>${e.to}`);
  assert.ok(observed.includes('src/game.ts#playTurn>src/combat.ts#attack'));
  assert.ok(!observed.some(e => e.includes('legacyCritical')), 'misleading call site must stay static-only');
  assert.ok(graph.staticEdges.some(e => e.to === 'src/combat.ts#legacyCritical'));
  assert.ok(graph.observedEdges.every(e => e.provenance === 'observed' && e.runIds.includes(run.id)));
});

test('failed runs are kept as evidence, async parents are tracked, contrasting runs diff', async () => {
  const { studio, project, entry } = await setup();
  const later = studio.addEntry(project.id, 'src/game.ts#playTurnLater');
  const dead = await studio.execute(project.id, entry.id, [{ ...hero, hp: 0 }, slime]);
  assert.equal(dead.run.status, 'error');
  assert.match(dead.run.error ?? '', /cannot act at 0 hp/);
  assert.equal(dead.events[0].threw, true);
  const crit = await studio.execute(project.id, entry.id, [{ ...hero, attack: 120 }, slime]);
  assert.ok(crit.events.some(e => e.symbol === 'src/combat.ts#legacyCritical'));
  const normal = await studio.execute(project.id, entry.id, [hero, slime]);
  const diff = studio.diff(normal.run.id, crit.run.id);
  assert.deepEqual(diff.onlyInB, ['src/combat.ts#legacyCritical']);
  assert.notEqual(diff.firstDivergence, null);
  const asyncRun = await studio.execute(project.id, later.id, [hero, slime]);
  assert.equal(asyncRun.events[0].async, true);
  assert.equal(asyncRun.events[1].symbol, 'src/game.ts#playTurn');
  assert.equal(asyncRun.events[1].parent, 0);
});

test('only allowlisted exported functions run; no sandbox means no run', async () => {
  const { studio, project, sandbox, entry } = await setup();
  assert.throws(() => studio.addEntry(project.id, 'src/save.ts#MemorySave.write'), ValidationError);
  await assert.rejects(studio.execute(project.id, 'ent_nope', []), ValidationError);
  sandbox.available = false;
  const before = sandbox.calls;
  await assert.rejects(studio.execute(project.id, entry.id, [hero, slime]), SandboxUnavailableError);
  assert.equal(sandbox.calls, before);
  assert.equal(studio.runs(project.id).length, 0);
  assert.ok(studio.graph(project.id).symbols.length > 0, 'static inspection still works');
});

test('editing source marks earlier runs stale and removes their observed edges', async () => {
  const { dir, studio, project, entry } = await setup();
  const { run } = await studio.execute(project.id, entry.id, [hero, slime]);
  appendFileSync(join(dir, 'src/damage.ts'), '\n// edited\n');
  studio.refresh(project.id);
  const [after] = studio.runs(project.id);
  assert.equal(after.id, run.id);
  assert.equal(after.stale, true);
  assert.deepEqual(after.staleFiles, ['src/damage.ts']);
  const graph = studio.graph(project.id);
  assert.equal(graph.observedEdges.length, 0);
  assert.equal(graph.staleRuns, 1);
  assert.equal(studio.resolve(project.id, 'event', `${run.id}#0`).freshness, 'stale');
});

test('secrets are redacted before storage', async () => {
  const { dir, studio, project } = await setup();
  const login = studio.addEntry(project.id, 'src/account.ts#login');
  const { events, run } = await studio.execute(project.id, login.id, [{ name: 'ann', password: 'hunter2' }]);
  assert.ok(!JSON.stringify(events).includes('hunter2'));
  assert.ok(!run.inputs.includes('hunter2'));
  writeFileSync(join(dir, 'src/account.ts'), readFileSync(join(dir, 'src/account.ts'), 'utf8').replace('`welcome ${user.name}`', '`welcome ${user.name} sk-abcdefghijklmnopqrstuvwx`'));
  const leaked = await studio.execute(project.id, login.id, [{ name: 'ann', password: 'x' }]);
  assert.ok(!leaked.run.output.includes('sk-abcdefghijklmnop'), leaked.run.output);
});

test('runs and events are immutable in the store', async () => {
  const { studio, project, entry } = await setup();
  const { run } = await studio.execute(project.id, entry.id, [hero, slime]);
  assert.throws(() => studio.store.db.prepare('UPDATE runs SET data = ? WHERE id = ?').run('{}', run.id), /immutable/);
  assert.throws(() => studio.store.db.prepare('UPDATE events SET data = ? WHERE run_id = ?').run('{}', run.id), /immutable/);
});

test('a forged trace (unknown symbol) is rejected and nothing is stored', async () => {
  const { dir, studio, project, entry } = await setup();
  writeFileSync(join(dir, 'src/game.ts'), readFileSync(join(dir, 'src/game.ts'), 'utf8')
    + '\nglobalThis.__mindmeld.span("src/fake.ts#invented", [], [], () => 1, undefined);\n');
  await assert.rejects(studio.execute(project.id, entry.id, [hero, slime]), /invalid trace event/);
  assert.equal(studio.runs(project.id).length, 0);
});

test('bundles round-trip and tampered bundles are rejected', async () => {
  const { studio, project, entry } = await setup();
  await studio.execute(project.id, entry.id, [hero, slime]);
  const bundle = studio.exportBundle(project.id);
  const imported = studio.importBundle(JSON.parse(JSON.stringify(bundle)));
  const g = studio.graph(imported.id);
  assert.equal(g.observedEdges.length, studio.graph(project.id).observedEdges.length);
  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.sources['src/damage.ts'] += '// x';
  assert.throws(() => studio.importBundle(tampered), /hash mismatch/);
  const forged = JSON.parse(JSON.stringify(bundle));
  forged.events[forged.runs[0].id][0].symbol = 'src/nope.ts#x';
  delete forged.bundleHash;
  const { sha256 } = await import('../src/hash.ts');
  forged.bundleHash = sha256(JSON.stringify(forged));
  assert.throws(() => studio.importBundle(forged), /invalid trace event/);
  await assert.rejects(studio.execute(imported.id, entry.id, []), ValidationError);
});

test('run workspace files are written read-only and the harness package.json wins over the repo one', async () => {
  const { studio, project, entry } = await setup();
  const { mkdtempSync, readdirSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'mm-runroot-'));
  studio.opts.runDir = root;
  const seen: string[] = [];
  const original = studio.opts.sandbox.run.bind(studio.opts.sandbox);
  studio.opts.sandbox.run = spec => {
    seen.push(readFileSync(join(spec.workdir, 'package.json'), 'utf8'));
    assert.equal(statSync(join(spec.workdir, 'src/game.js')).mode & 0o222, 0, 'emitted source must not be writable');
    return original(spec);
  };
  const { run } = await studio.execute(project.id, entry.id, [hero, slime]);
  assert.equal(run.status, 'ok');
  assert.deepEqual(JSON.parse(seen[0]), { type: 'module', private: true });
  assert.deepEqual(readdirSync(root), [], 'run workspace is removed afterwards');
});
