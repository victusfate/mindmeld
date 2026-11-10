#!/usr/bin/env node
// Container smoke test: starts the mindmeld-studio image read-only with the host Docker socket as the sandbox
// daemon, imports the fixture, runs an allowlisted entry in a real sandbox and checks the API's guards.
// Usage: node infra/smoke-test.ts [image]   (requires a local Docker daemon and node:26-alpine pulled)
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdirSync, chmodSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const IMAGE = process.argv[2] ?? 'mindmeld-studio:local';
const NAME = `mm-smoke-${process.pid}`;
const HOST_PORT = 18787;
const TOKEN = 'smoke-token';
const RUN_DIR = '/var/tmp/mindmeld-runs';
const STICKY_WORLD_WRITABLE = 0o1777;
const READY_ATTEMPTS = 40;
const READY_DELAY_MS = 250;
const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
const BASE = `http://127.0.0.1:${HOST_PORT}`;
const HEADERS = { host: '127.0.0.1:8787', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

const docker = (...args: string[]): string => {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`docker ${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
};
// node:http, not fetch: fetch forbids setting Host, and Studio validates Host against its own listen port.
function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = HEADERS): Promise<{ status: number; json: T; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(BASE + path, { method, headers }, res => {
      let text = '';
      res.on('data', (c: Buffer) => { text += c.toString(); });
      res.on('end', () => {
        let json: unknown;
        try { json = JSON.parse(text); } catch { json = text; }
        resolve({ status: res.statusCode ?? 0, json: json as T, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function waitReady(): Promise<void> {
  for (let i = 0; i < READY_ATTEMPTS; i++) {
    try { if ((await api('GET', '/api/health')).status === 200) return; } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, READY_DELAY_MS));
  }
  throw new Error(`studio did not become ready:\n${docker('logs', NAME)}`);
}

mkdirSync(RUN_DIR, { recursive: true });
chmodSync(RUN_DIR, STICKY_WORLD_WRITABLE);
const socketGid = String(statSync('/var/run/docker.sock').gid);
docker('run', '-d', '--name', NAME, '--init', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '-p', `127.0.0.1:${HOST_PORT}:8787`, '-e', `MINDMELD_TOKEN=${TOKEN}`, '-e', 'MINDMELD_SANDBOX=docker', '-e', 'MINDMELD_MODEL_PROVIDER=none',
  '-e', 'MINDMELD_ALLOWED_ROOTS=/workspace', '--group-add', socketGid, '-v', '/var/run/docker.sock:/var/run/docker.sock',
  '-v', `${RUN_DIR}:${RUN_DIR}`, '-v', `${FIXTURES}:/workspace:ro`, IMAGE);
try {
  await waitReady();
  const status = await api<{ sandbox: { available: boolean; reason: string } }>('GET', '/api/status');
  assert.equal(status.json.sandbox.available, true, status.json.sandbox.reason);
  assert.equal((await api('GET', '/api/projects', undefined, { host: 'evil.example:8787' })).status, 421);
  assert.equal((await api('GET', '/api/projects', undefined, { host: '127.0.0.1:8787' })).status, 401);
  assert.equal((await api('POST', '/api/projects', { kind: 'local', ref: '/etc' })).status, 400);
  const { json: created } = await api<{ project: { id: string } }>('POST', '/api/projects', { kind: 'local', ref: '/workspace/combat-game' });
  const id = created.project.id;
  const { json: entry } = await api<{ id: string }>('POST', `/api/projects/${id}/entries`, { symbolId: 'src/game.ts#playTurn' });
  const inputs = [{ name: 'h', hp: 9, attack: 5, armor: 0 }, { name: 'f', hp: 9, attack: 1, armor: 1 }];
  const { json: run } = await api<{ run: { status: string; sandbox: { connector: string }; runtimeVersion: string }; events: unknown[] }>('POST', `/api/projects/${id}/runs`, { entryId: entry.id, inputs });
  assert.ok(run.run, JSON.stringify(run));
  assert.equal(run.run.status, 'ok');
  assert.equal(run.run.sandbox.connector, 'docker-oci');
  assert.equal(run.events.length, 5);
  const page = await api('GET', '/', undefined, { host: '127.0.0.1:8787' });
  assert.match(String(page.headers['content-security-policy']), /default-src 'self'/);
  console.log(`smoke ok: ${IMAGE} ran ${run.events.length} events in ${run.run.runtimeVersion}`);
} finally {
  if (process.env.KEEP) console.log(spawnSync('docker', ['logs', NAME], { encoding: 'utf8' }).stderr); spawnSync('docker', ['rm', '-f', NAME]);
}
