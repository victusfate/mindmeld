import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedNavigation, loginUrl, serverOrigin, webPreferences, windowOpenAction } from '../src/policy.ts';

const origin = serverOrigin('http://127.0.0.1:43210/');

test('navigation stays on the exact server origin', () => {
  assert.equal(origin, 'http://127.0.0.1:43210');
  assert.ok(isAllowedNavigation('http://127.0.0.1:43210/projects/1', origin));
  for (const url of ['https://example.com/', 'http://127.0.0.1:43211/', 'http://localhost:43210/', 'https://127.0.0.1:43210/',
    'file:///etc/passwd', 'javascript:alert(1)', 'not a url', '']) {
    assert.equal(isAllowedNavigation(url, origin), false, url);
  }
});

test('window.open is denied; only credential-free external http(s) goes to the system browser', () => {
  assert.equal(windowOpenAction('https://example.com/docs', origin), 'open-external');
  assert.equal(windowOpenAction('http://example.com/', origin), 'open-external');
  for (const url of ['http://127.0.0.1:43210/x', 'file:///tmp/x', 'javascript:alert(1)', 'mailto:a@b.c', 'https://u:p@example.com/', 'bad']) {
    assert.equal(windowOpenAction(url, origin), 'deny', url);
  }
});

test('login URL carries the token to /auth on the server', () => {
  assert.equal(loginUrl('http://127.0.0.1:43210/', 'a b&c'), 'http://127.0.0.1:43210/auth?token=a+b%26c');
});

test('renderer is isolated, sandboxed and has no Node, webview or preload', () => {
  const prefs = webPreferences();
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.preload, undefined);
});
