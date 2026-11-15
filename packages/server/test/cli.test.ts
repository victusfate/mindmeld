import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from '@mindmeld/core';
import { DEFAULT_PORT, PORT_FALLBACK_NOTE } from '../src/bootstrap.ts';
import { CliUsageError, findLocalProject, openCommand, parseCli } from '../src/cli-args.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const FIXTURE = new URL('../../../fixtures/combat-game', import.meta.url).pathname;
const READY_TIMEOUT_MS = 30_000;
const ENV: NodeJS.ProcessEnv = { ...process.env, MINDMELD_SANDBOX: 'none', MINDMELD_MODEL_PROVIDER: 'none' };
delete ENV.MINDMELD_PORT;

test('parseCli: positional paths, --project alias, --no-open, readable errors', () => {
  const a = parseCli(['.', '--project', 'b', '--include', 'src', '--no-open', '--port', '9000']);
  assert.deepEqual(a.projects, ['.', 'b']);
  assert.deepEqual(a.include, ['src']);
  assert.equal(a.open, false);
  assert.equal(a.port, 9000);
  assert.equal(parseCli([]).open, true);
  assert.equal(parseCli(['-h']).help, true);
  assert.throws(() => parseCli(['--port', 'abc']), CliUsageError);
  assert.throws(() => parseCli(['--bogus']), CliUsageError);
  assert.deepEqual([parseCli(['mcp']).command, parseCli(['mcp']).projects], ['mcp', ['.']], 'mcp defaults to the current directory');
  assert.deepEqual(parseCli(['mcp', 'repo']).projects, ['repo']);
  assert.equal(parseCli(['repo']).command, 'serve');
  assert.throws(() => parseCli(['mcp', 'a', 'b']), /at most one PATH/);
  assert.deepEqual([parseCli(['explorer', '--out', 'd']).command, parseCli(['explorer']).projects, parseCli(['explorer', '--out', 'd']).out], ['explorer', ['.'], 'd']);
});

test('openCommand: macOS, Windows, WSL and other Linux', () => {
  const url = 'http://127.0.0.1:1/auth?token=t';
  assert.deepEqual(openCommand(url, 'darwin', {}), ['open', [url]]);
  assert.deepEqual(openCommand(url, 'win32', {}), ['cmd', ['/c', 'start', '""', url]]);
  assert.deepEqual(openCommand(url, 'linux', { WSL_DISTRO_NAME: 'Ubuntu' }), ['explorer.exe', [url]]);
  assert.deepEqual(openCommand(url, 'linux', {}), ['xdg-open', [url]]);
});

test('findLocalProject matches root and include scope, in any order', () => {
  const p = (id: string, root: string, include?: string[]): Project => ({ id, name: id, sourceKind: 'local', sourceRef: root, root, createdAt: '', ...(include ? { include } : {}) });
  const projects = [p('a', '/r'), p('b', '/r', ['src', 'lib']), p('c', '/other')];
  assert.equal(findLocalProject(projects, '/r', undefined)?.id, 'a');
  assert.equal(findLocalProject(projects, '/r', ['lib/', 'src'])?.id, 'b');
  assert.equal(findLocalProject(projects, '/r', ['src']), undefined);
});

test('an unknown flag prints usage and exits 2, without a stack trace', () => {
  const r = spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: mindmeld/);
  assert.doesNotMatch(r.stderr, /at .*\.ts:\d+/);
  const missing = spawnSync(process.execPath, [CLI, '/no/such/repo', '--no-open'], { encoding: 'utf8', env: ENV });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /not a directory: \/no\/such\/repo/);
});

/** Starts the CLI and resolves with its login URL once printed; the caller stops it through the returned handle. */
function startCli(args: string[]): { child: ChildProcess; ready: Promise<{ url: string; output: string }> } {
  const child = spawn(process.execPath, [CLI, ...args], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise<{ url: string; output: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no login URL within ${READY_TIMEOUT_MS} ms:\n${output}`)), READY_TIMEOUT_MS);
    const read = (chunk: Buffer): void => {
      output += String(chunk);
      const m = /Mind Meld Studio: (\S+)/.exec(output);
      if (m) { clearTimeout(timer); resolve({ url: m[1], output }); }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`exited ${code}:\n${output}`)); });
  });
  return { child, ready };
}

async function stopCli(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

const location = (url: string): Promise<string | undefined> => new Promise((resolve, reject) => {
  const u = new URL(url);
  request({ host: u.hostname, port: u.port, path: u.pathname + u.search }, res => { res.resume(); resolve(res.headers.location); })
    .on('error', reject).end();
});

/** Holds the default port so the CLI must fall back; if something else already holds it, the CLI falls back anyway. */
async function holdDefaultPort(): Promise<Server | null> {
  const server = createServer();
  return new Promise(resolve => {
    server.once('error', () => resolve(null));
    server.listen(DEFAULT_PORT, '127.0.0.1', () => resolve(server));
  });
}

test('mindmeld PATH imports once, reuses the import, falls back from a busy port and opens the project', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mm-cli-'));
  const blocker = await holdDefaultPort();
  try {
    const first = startCli([FIXTURE, '--data', data, '--no-open']);
    try {
      const { url, output } = await first.ready;
      assert.match(output, /imported combat-game/);
      assert.ok(output.includes(PORT_FALLBACK_NOTE));
      assert.notEqual(new URL(url).port, String(DEFAULT_PORT));
      assert.match(await location(url) ?? '', /^\/\?project=prj_[0-9a-f]+$/);
    } finally { await stopCli(first.child); }
    const second = startCli([FIXTURE, '--data', data, '--no-open']);
    try {
      assert.match((await second.ready).output, /refreshed combat-game/, 'a second launch reuses the project');
    } finally { await stopCli(second.child); }
  } finally { await new Promise(resolve => (blocker ? blocker.close(resolve) : resolve(undefined))); }
});
