import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { editorFromEnv, launch, DEFAULT_WEB_DIR } from '../src/index.ts';

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
    const reported = await (await fetch(`${running.url}/api/status`, { headers: { authorization: 'Bearer tok' } })).json() as { editor: unknown };
    assert.deepEqual(reported.editor, { scheme: 'vscode', remote: null }, '/api/status reports the editor links target');
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

test('editorFromEnv: VS Code by default, a WSL remote when in WSL, none turns links off, typos fail', () => {
  assert.deepEqual(editorFromEnv({}), { scheme: 'vscode', remote: null });
  assert.deepEqual(editorFromEnv({ MINDMELD_EDITOR: 'cursor', WSL_DISTRO_NAME: 'Ubuntu' }), { scheme: 'cursor', remote: 'wsl+Ubuntu' });
  assert.equal(editorFromEnv({ MINDMELD_EDITOR: 'none' }), null);
  assert.throws(() => editorFromEnv({ MINDMELD_EDITOR: 'vscdoe' }), /MINDMELD_EDITOR must be one of/);
});
