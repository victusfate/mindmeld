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
