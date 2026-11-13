import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, Studio } from '@mindmeld/core';
import { LocalDirectorySource } from '@mindmeld/connectors';
import { startServer, type RunningServer } from '../src/index.ts';
import { HostProcessSandbox, ScriptedModel, copyFixture } from '../../core/test/helpers.ts';

const web = mkdtempSync(join(tmpdir(), 'mm-web-'));
mkdirSync(join(web, 'assets'));
writeFileSync(join(web, 'index.html'), '<!doctype html><title>studio</title>');
writeFileSync(join(web, 'assets/app.js'), 'console.log(1)');
const model = new ScriptedModel(m => (m[1].content.includes('[S:src/game.ts#playTurn]') ? 'playTurn attacks then saves [S:src/game.ts#playTurn].' : 'unknown: no evidence.'));
const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model, sources: [new LocalDirectorySource()] });
const srv: RunningServer = await startServer({ studio, webDir: web, token: 'test-token-123' });
after(() => srv.close());
const port = new URL(srv.url).port;

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string; json: any }
function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { authorization: 'Bearer test-token-123', host: `127.0.0.1:${port}`, ...opts.headers } }, res => {
      let body = '';
      res.on('data', c => { body += String(c); });
      res.on('end', () => { let json: unknown; try { json = JSON.parse(body); } catch { json = undefined; } resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json }); });
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

test('health is public; the API requires the token', async () => {
  assert.equal((await call('GET', '/api/health', { headers: { authorization: '' } })).status, 200);
  assert.equal((await call('GET', '/api/projects', { headers: { authorization: '' } })).status, 401);
  assert.equal((await call('GET', '/api/projects', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call('GET', '/api/projects')).status, 200);
});

test('DNS rebinding and cross-origin requests are refused', async () => {
  assert.equal((await call('GET', '/api/projects', { headers: { host: 'evil.example:80' } })).status, 421);
  assert.equal((await call('GET', '/api/projects', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('GET', '/api/projects', { headers: { origin: `http://localhost:${port}` } })).status, 200);
});

test('cookie login, CSRF guard and security headers', async () => {
  assert.equal((await call('GET', '/auth?token=nope')).status, 401);
  const login = await call('GET', '/auth?token=test-token-123', { headers: { authorization: '' } });
  assert.equal(login.status, 303);
  const cookie = String(login.headers['set-cookie']);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const jar = { authorization: '', cookie: cookie.split(';')[0] };
  assert.equal((await call('GET', '/api/projects', { headers: jar })).status, 200);
  assert.equal((await call('POST', '/api/projects', { headers: jar, body: { kind: 'local', ref: '/tmp' } })).status, 403);
  const page = await call('GET', '/');
  assert.match(String(page.headers['content-security-policy']), /default-src 'self'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
});

test('static files cannot escape the web directory', async () => {
  assert.equal((await call('GET', '/assets/app.js')).body, 'console.log(1)');
  const escape = await call('GET', '/..%2F..%2F..%2Fetc%2Fpasswd');
  assert.ok(!escape.body.includes('root:'));
  assert.match((await call('GET', '/some/deep/route')).body, /<title>studio/);
});

test('end-to-end over HTTP: import, graph, allowlist, run, diff, ask, citation, bundle', async () => {
  const dir = copyFixture();
  const created = await call('POST', '/api/projects', { body: { kind: 'local', ref: dir } });
  assert.equal(created.status, 200, created.body);
  const id = created.json.project.id as string;
  const graph = (await call('GET', `/api/projects/${id}/graph`)).json;
  assert.ok(graph.symbols.length >= 10);
  assert.equal(graph.observedEdges.length, 0);
  const src = await call('GET', `/api/projects/${id}/source?path=src/game.ts`);
  assert.match(src.json.content, /playTurn/);
  assert.equal((await call('GET', `/api/projects/${id}/source?path=../../etc/passwd`)).status, 404);
  assert.equal((await call('POST', `/api/projects/${id}/entries`, { body: { symbolId: 'src/save.ts#MemorySave.write' } })).status, 400);
  const entry = (await call('POST', `/api/projects/${id}/entries`, { body: { symbolId: 'src/game.ts#playTurn' } })).json;
  assert.equal((await call('POST', `/api/projects/${id}/runs`, { body: { entryId: 'ent_x', inputs: [] } })).status, 400);
  const hero = { name: 'h', hp: 9, attack: 5, armor: 0 }, foe = { name: 'f', hp: 9, attack: 1, armor: 1 };
  const a = (await call('POST', `/api/projects/${id}/runs`, { body: { entryId: entry.id, inputs: [hero, foe] } })).json;
  const b = (await call('POST', `/api/projects/${id}/runs`, { body: { entryId: entry.id, inputs: [{ ...hero, attack: 200 }, foe] } })).json;
  assert.equal(a.run.status, 'ok');
  const diff = (await call('GET', `/api/runs/${a.run.id}/diff/${b.run.id}`)).json;
  assert.deepEqual(diff.onlyInB, ['src/combat.ts#legacyCritical']);
  const observed = (await call('GET', `/api/projects/${id}/graph`)).json.observedEdges;
  assert.ok(observed.length >= 4);
  const answer = (await call('POST', `/api/projects/${id}/ask`, { body: { question: 'what does playTurn do?' } })).json;
  assert.equal(answer.abstained, false);
  const cite = (await call('GET', `/api/projects/${id}/citation?kind=event&ref=${encodeURIComponent(`${a.run.id}#1`)}`)).json;
  assert.equal(cite.valid, true);
  assert.equal(cite.freshness, 'fresh');
  const bundle = (await call('GET', `/api/projects/${id}/bundle`)).json;
  assert.equal((await call('POST', '/api/bundles', { body: bundle })).status, 200);
  bundle.sources['src/game.ts'] += ' ';
  const rejected = await call('POST', '/api/bundles', { body: bundle });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json.error, /hash mismatch/);
  assert.equal((await call('GET', '/api/runs/run_missing')).status, 404);
});

test('oversized and malformed bodies are rejected', async () => {
  assert.equal((await call('POST', '/api/projects', { body: { kind: 'local', ref: 'x'.repeat(2_100_000) } })).status, 413);
  const bad = await new Promise<number>(resolve => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/projects', headers: { authorization: 'Bearer test-token-123' } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.end('{not json');
  });
  assert.equal(bad, 400);
});

test('usage summary and JSONL export are shared back over the API', async () => {
  const summary = await call('GET', '/api/usage');
  assert.equal(summary.status, 200);
  assert.ok(summary.json.totals.count >= 1);
  const exported = await call('GET', '/api/usage/export');
  assert.match(String(exported.headers['content-type']), /ndjson/);
  const rows = exported.body.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rows.length, summary.json.totals.count);
  assert.equal((await call('GET', '/api/usage/export', { headers: { authorization: '' } })).status, 401);
});

test('malformed percent-encoding is a 400, never a crash (static and API paths)', async () => {
  assert.equal((await call('GET', '/%E0%A4%A', { headers: { authorization: '' } })).status, 400);
  assert.equal((await call('GET', '/api/runs/%E0%A4%A')).status, 400);
  assert.equal((await call('GET', '/api/health')).status, 200, 'server still alive');
});

test('POST /api/projects accepts an optional include scope and rejects malformed ones', async () => {
  const dir = copyFixture();
  const scoped = await call('POST', '/api/projects', { body: { kind: 'local', ref: dir, include: ['src'] } });
  assert.equal(scoped.status, 200, scoped.body);
  assert.deepEqual(scoped.json.project.include, ['src']);
  assert.ok(scoped.json.snapshot.files.every((f: { path: string }) => f.path.startsWith('src/')));
  for (const include of ['src', [1], ['../x']]) {
    assert.equal((await call('POST', '/api/projects', { body: { kind: 'local', ref: dir, include } })).status, 400, JSON.stringify(include));
  }
});
