import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, launchLocal, DEFAULT_WEB_DIR } from '../src/index.ts';

test('launch wires store, connectors and server from the environment', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mm-launch-'));
  const env = { MINDMELD_SANDBOX: 'none', MINDMELD_MODEL_PROVIDER: 'none', MINDMELD_ALLOWED_HOSTS: 'studio.local', MINDMELD_PORT: '0' };
  const { studio, running, notes } = await launch({ env, dataDir, token: 'tok' });
  try {
    assert.equal(running.token, 'tok');
    assert.deepEqual(notes, []);
    const status = await studio.status();
    assert.equal(status.sandbox.available, false);
    assert.equal(status.model.available, false);
    assert.match(status.indexer, /rust\/.* python\/.* gdscript\//, 'backend indexes the tree-sitter languages');
    const res = await fetch(`${running.url}/api/health`);
    assert.equal(res.status, 200);
  } finally { await running.close(); }
  assert.match(DEFAULT_WEB_DIR, /web[/\\]dist$/);
});

test('cli --usage prints a shareable report from the data dir', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mm-cli-usage-'));
  const cli = new URL('../src/cli.ts', import.meta.url).pathname;
  const text = spawnSync(process.execPath, [cli, '--usage', '--data', dataDir], { encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /no activity recorded yet/);
  const json = spawnSync(process.execPath, [cli, '--usage', '--json', '--data', dataDir], { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
});

test('launchLocal: loopback on a random port with a fresh token; close() releases server and store', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mm-local-'));
  const backend = await launchLocal({ env: { MINDMELD_SANDBOX: 'none', MINDMELD_MODEL_PROVIDER: 'none', MINDMELD_PORT: '8787' }, dataDir });
  assert.match(backend.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(new URL(backend.url).port, '8787', 'never the shared default port');
  assert.ok(backend.token.length >= 32);
  const status = await fetch(`${backend.url}/api/status`, { headers: { authorization: `Bearer ${backend.token}` } });
  assert.equal(status.status, 200);
  await backend.close();
  await assert.rejects(fetch(`${backend.url}/api/health`));
  assert.throws(() => backend.studio.store.listProjects(), 'store is closed');
});
