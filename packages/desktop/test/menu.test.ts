import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { MENU_IDS, menuTemplate, statusText, type MenuActions } from '../src/menu.ts';

function recorder(): { calls: string[]; actions: MenuActions } {
  const calls: string[] = [];
  const actions: MenuActions = {
    openFolder: () => calls.push('openFolder'), importBundle: () => calls.push('importBundle'), exportUsage: () => calls.push('exportUsage'),
    showStatus: () => calls.push('showStatus'), showUsage: () => calls.push('showUsage'),
  };
  return { calls, actions };
}

const items = (template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  template.flatMap(menu => [menu, ...(Array.isArray(menu.submenu) ? menu.submenu : [])]);

test('every id-bearing item calls its action', () => {
  const { calls, actions } = recorder();
  const all = items(menuTemplate(actions, { dev: false, mac: false }));
  for (const id of Object.values(MENU_IDS)) {
    const item = all.find(i => i.id === id);
    assert.ok(item?.click, id);
    (item.click as () => void)();
  }
  assert.deepEqual(calls, ['openFolder', 'importBundle', 'exportUsage', 'showStatus', 'showUsage']);
});

test('DevTools only in dev; app menu only on mac', () => {
  const { actions } = recorder();
  const roles = (dev: boolean, mac: boolean): unknown[] => items(menuTemplate(actions, { dev, mac })).map(i => i.role);
  assert.ok(!roles(false, false).includes('toggleDevTools'));
  assert.ok(roles(true, false).includes('toggleDevTools'));
  assert.ok(roles(false, false).includes('reload'));
  assert.ok(!roles(false, false).includes('appMenu'));
  assert.ok(roles(false, true).includes('appMenu'));
});

test('status text names availability and reasons', () => {
  const text = statusText({
    sandbox: { name: 'disabled', available: false, reason: 'MINDMELD_SANDBOX=none' },
    model: { name: null, available: false, reason: 'no model configured (optional)' },
    indexer: 'typescript',
  });
  assert.equal(text, [
    'Sandbox: disabled — unavailable (MINDMELD_SANDBOX=none)',
    'Model: none — unavailable (no model configured (optional))',
    'Indexer: typescript',
  ].join('\n'));
});
