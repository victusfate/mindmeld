// API v1 contract: the route table and the shapes interfaces depend on. A failure here means a breaking change.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { EvidenceStore, Studio } from '@mindmeld/core';
import { LocalDirectorySource } from '@mindmeld/connectors';
import { API_ROUTES, API_VERSION, dispatchedRoutes, startServer } from '../src/index.ts';
import { HostProcessSandbox, ScriptedModel, copyFixture } from '../../core/test/helpers.ts';

const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model: new ScriptedModel(() => 'playTurn attacks [S:src/game.ts#playTurn].'), sources: [new LocalDirectorySource()] });
const srv = await startServer({ studio, token: 'contract' });
after(() => srv.close());
const port = new URL(srv.url).port;

function call(method: string, path: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { authorization: 'Bearer contract', host: `127.0.0.1:${port}` } }, res => {
      let text = '';
      res.on('data', c => { text += String(c); });
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch { return text; } })() }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const keys = (o: object): string[] => Object.keys(o).sort();
const hasAll = (o: object, want: string[]): void => { for (const k of want) assert.ok(k in o, `missing field ${k}`); };

test('v1 route table is frozen', () => {
  assert.equal(API_VERSION, 1);
  assert.deepEqual(dispatchedRoutes(studio).sort(), API_ROUTES.slice(3).sort());
});

test('v1 response shapes', async () => {
  hasAll((await call('GET', '/api/health')).json, ['ok', 'apiVersion']);
  const status = (await call('GET', '/api/status')).json;
  hasAll(status, ['apiVersion', 'sandbox', 'model', 'indexer']);
  hasAll(status.model, ['name', 'available', 'reason', 'model']);
  const { project, snapshot } = (await call('POST', '/api/projects', { kind: 'local', ref: copyFixture() })).json;
  hasAll(project, ['id', 'name', 'sourceKind', 'sourceRef', 'root', 'createdAt']);
  hasAll(snapshot, ['id', 'projectId', 'snapshotHash', 'createdAt', 'indexerVersion', 'files', 'skipped']);
  const graph = (await call('GET', `/api/projects/${project.id}/graph`)).json;
  assert.deepEqual(keys(graph), ['imports', 'observedEdges', 'project', 'snapshot', 'staleRuns', 'staticEdges', 'symbols']);
  hasAll(graph.symbols[0], ['id', 'name', 'kind', 'exported', 'async', 'params', 'span', 'fileHash']);
  hasAll(graph.staticEdges[0], ['provenance', 'from', 'to', 'kind', 'resolution', 'site']);
  const entry = (await call('POST', `/api/projects/${project.id}/entries`, { symbolId: 'src/game.ts#playTurn' })).json;
  hasAll(entry, ['id', 'projectId', 'symbolId', 'note', 'createdAt']);
  const ran = (await call('POST', `/api/projects/${project.id}/runs`, { entryId: entry.id, inputs: [{ name: 'a', hp: 3, attack: 3, armor: 0 }, { name: 'b', hp: 3, attack: 1, armor: 0 }] })).json;
  hasAll(ran.run, ['id', 'projectId', 'snapshotId', 'snapshotHash', 'entrySymbol', 'inputs', 'status', 'output', 'error', 'stdout', 'truncated', 'createdAt', 'durationMs', 'sandbox', 'runtimeVersion', 'fileHashes', 'stale', 'staleFiles']);
  hasAll(ran.events[0], ['runId', 'seq', 'symbol', 'parent', 'depth', 'args', 'result', 'threw', 'async', 'thisBefore', 'thisAfter', 'startMs', 'durationMs']);
  hasAll((await call('GET', `/api/runs/${ran.run.id}/diff/${ran.run.id}`)).json, ['a', 'b', 'sameSnapshot', 'outputA', 'outputB', 'statusA', 'statusB', 'rows', 'firstDivergence', 'onlyInA', 'onlyInB']);
  const answer = (await call('POST', `/api/projects/${project.id}/ask`, { question: 'what does playTurn do?' })).json;
  hasAll(answer, ['question', 'abstained', 'text', 'sentences', 'citations', 'unknowns', 'assumptions', 'model', 'usage']);
  hasAll(answer.usage, ['model', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd']);
  hasAll(answer.citations[0], ['kind', 'ref', 'valid', 'freshness', 'span', 'fileHash', 'label']);
  const usage = (await call('GET', '/api/usage')).json;
  assert.deepEqual(keys(usage), ['groups', 'limits', 'recent', 'since', 'totals', 'windows']);
  assert.deepEqual(keys(usage.windows), ['fiveHour', 'sevenDay']);
  hasAll(usage.totals, ['count', 'failed', 'durationMs', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'unknownCost']);
  hasAll(usage.recent[0], ['id', 'at', 'kind', 'projectId', 'provider', 'durationMs', 'ok', 'detail', 'model', 'inputTokens', 'outputTokens', 'costUsd']);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});
