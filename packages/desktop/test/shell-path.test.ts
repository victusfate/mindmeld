import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastLine, loginShellPath, mergePath } from '../src/shell-path.ts';
import { usageJsonl } from '../src/usage-export.ts';
import type { UsageRecord } from '@mindmeld/core';

test('login-shell PATH entries come first, current-only entries are kept, duplicates and blanks dropped', () => {
  assert.equal(mergePath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin:/Users/me/.local/bin', ':'),
    '/opt/homebrew/bin:/usr/bin:/Users/me/.local/bin:/bin');
  assert.equal(mergePath('/usr/bin::/bin:', undefined, ':'), '/usr/bin:/bin');
  assert.equal(mergePath(undefined, '/a: /b ', ':'), '/a:/b');
  assert.equal(mergePath('C:\\x;C:\\y', 'C:\\y;C:\\z', ';'), 'C:\\y;C:\\z;C:\\x');
});

test('profile banners before the PATH are ignored', () => {
  assert.equal(lastLine('Welcome!\n\n/usr/local/bin:/usr/bin'), '/usr/local/bin:/usr/bin');
  assert.equal(lastLine(''), '');
});

test('the login shell is asked once; failures and Windows yield null', async () => {
  assert.equal(await loginShellPath({ SHELL: '/bin/sh', PATH: '/usr/bin:/bin' }, 'linux').then(p => p?.includes('/usr/bin')), true);
  assert.equal(await loginShellPath({ SHELL: '/nonexistent/shell' }, 'linux'), null);
  assert.equal(await loginShellPath({ SHELL: '/bin/sh' }, 'win32'), null);
});

test('usage export is one JSON record per line', () => {
  const rec = (id: string): UsageRecord => ({ id, kind: 'index' } as unknown as UsageRecord);
  assert.equal(usageJsonl([]), '');
  const text = usageJsonl([rec('a'), rec('b')]);
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(text.trim().split('\n').map(line => (JSON.parse(line) as { id: string }).id), ['a', 'b']);
});
