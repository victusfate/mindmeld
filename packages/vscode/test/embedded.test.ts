// Standalone mode: with no backend setting, activate() starts the Studio backend inside the extension host and
// connects to it, so import works with no server to start and no login URL to paste.
import './vscode-hook.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyFixture } from '../../core/test/helpers.ts';
import { fake, fakeContext, Uri } from './fake-vscode.ts';

process.env.MINDMELD_SANDBOX = 'none';
process.env.MINDMELD_MODEL_PROVIDER = 'none';
const { activate, deactivate } = await import('../src/extension.ts');

test('the extension embeds its own backend: no Connect, multi-language import, clean shutdown', async () => {
  const dir = realpathSync(copyFixture());
  writeFileSync(join(dir, 'tool.py'), 'def run():\n    pass\n');
  fake.folder = Uri.file(dir);
  const api = activate(fakeContext() as never);
  await api.ready;
  const errors = () => fake.messages.filter(m => m.level === 'error').map(m => m.text);
  assert.deepEqual(errors(), []);
  assert.match(api.session.status?.indexer ?? '', /python\//);
  const baseUrl = api.session.baseUrl;
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  await fake.commands.get('mindmeld.importWorkspace')!();
  assert.deepEqual(errors(), []);
  assert.ok(api.session.graph!.symbols.some(s => s.id === 'tool.py#run'));
  assert.ok(api.session.graph!.symbols.some(s => s.id === 'src/game.ts#playTurn'));

  await fake.commands.get('mindmeld.openStudio')!();
  assert.match(fake.opened.at(-1) ?? '', new RegExp(`^${baseUrl}/auth\\?token=`));

  await deactivate();
  await assert.rejects(fetch(`${baseUrl}/api/health`));
});

test('deactivating while the backend is still starting shuts that backend down', async () => {
  fake.folder = Uri.file(realpathSync(copyFixture()));
  const api = activate(fakeContext() as never);
  await deactivate();
  await api.ready;
  assert.ok(api.session.baseUrl === '' || await fetch(`${api.session.baseUrl}/api/health`).then(() => false, () => true), 'no backend left listening');
});
