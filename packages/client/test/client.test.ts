import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceStore, Studio } from '@mindmeld/core';
import { LocalDirectorySource } from '@mindmeld/connectors';
import { startServer } from '@mindmeld/server';
import { StudioClient, ApiError } from '../src/index.ts';
import { HostProcessSandbox, copyFixture } from '../../core/test/helpers.ts';

const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model: null, sources: [new LocalDirectorySource()] });
const srv = await startServer({ studio });
after(() => srv.close());

test('client drives the whole API with a bearer token', async () => {
  const c = new StudioClient({ baseUrl: srv.url, token: srv.token });
  assert.equal((await c.health()).ok, true);
  const status = await c.status();
  assert.equal(status.model.available, false);
  const { project } = await c.addProject('local', copyFixture());
  const graph = await c.graph(project.id);
  assert.ok(graph.symbols.some(s => s.id === 'src/game.ts#playTurn'));
  const entry = await c.addEntry(project.id, 'src/game.ts#playTurn');
  const a = await c.execute(project.id, entry.id, [{ name: 'a', hp: 3, attack: 3, armor: 0 }, { name: 'b', hp: 3, attack: 1, armor: 0 }]);
  assert.equal(a.run.status, 'ok');
  assert.equal((await c.run(a.run.id)).events.length, a.events.length);
  assert.equal((await c.diff(a.run.id, a.run.id)).firstDivergence, null);
  assert.equal((await c.citation(project.id, 'symbol', 'src/game.ts#playTurn')).valid, true);
  await assert.rejects(c.ask(project.id, 'what is playTurn?'), (e: unknown) => e instanceof ApiError && e.status === 503);
  const imported = await c.importBundle(await c.exportBundle(project.id));
  assert.match(imported.name, /bundle/);
});

test('client surfaces auth failures as ApiError 401', async () => {
  await assert.rejects(new StudioClient({ baseUrl: srv.url, token: 'nope' }).projects(), (e: unknown) => e instanceof ApiError && e.status === 401);
});

test('client covers project, source, entries, runs, refresh and usage endpoints', async () => {
  const c = new StudioClient({ baseUrl: srv.url + '/', token: srv.token });
  const { project } = await c.addProject('local', copyFixture(), 'named');
  assert.equal(project.name, 'named');
  assert.equal((await c.project(project.id)).project.id, project.id);
  assert.equal((await c.refresh(project.id)).projectId, project.id);
  assert.match((await c.source(project.id, 'src/game.ts')).content, /playTurn/);
  const entry = await c.addEntry(project.id, 'src/game.ts#playTurn', 'demo');
  assert.deepEqual((await c.entries(project.id)).map(e => e.note), ['demo']);
  await c.execute(project.id, entry.id, [{ name: 'a', hp: 1, attack: 1, armor: 0 }, { name: 'b', hp: 1, attack: 1, armor: 0 }], 5000);
  assert.equal((await c.runs(project.id)).length, 1);
  assert.ok((await c.projects()).length >= 2);
  const usage = await c.usage(project.id);
  assert.deepEqual(Object.keys(usage.windows).sort(), ['fiveHour', 'sevenDay']);
  assert.ok((await c.usageExport(project.id)).every(r => r.projectId === project.id));
  assert.ok((await c.usageExport()).length >= (await c.usageExport(project.id)).length);
  await assert.rejects(new StudioClient({ baseUrl: srv.url, token: 'bad' }).usageExport(), (e: unknown) => e instanceof ApiError && e.status === 401);
  await assert.rejects(c.source(project.id, 'nope.ts'), (e: unknown) => e instanceof ApiError && e.status === 404 && /not in the snapshot/.test(e.message));
});

test('client tolerates non-JSON error bodies', async () => {
  const fake = (() => Promise.resolve(new Response('plain failure', { status: 502 }))) as unknown as typeof fetch;
  await assert.rejects(new StudioClient({ fetch: fake }).health(), (e: unknown) => e instanceof ApiError && e.status === 502 && e.message === 'plain failure');
  const empty = (() => Promise.resolve(new Response('', { status: 500 }))) as unknown as typeof fetch;
  await assert.rejects(new StudioClient({ fetch: empty }).health(), (e: unknown) => e instanceof ApiError && e.message === 'HTTP 500');
});
