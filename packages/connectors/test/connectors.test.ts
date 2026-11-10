import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, Studio, SandboxUnavailableError } from '@mindmeld/core';
import { OciSandbox, DisabledSandbox, OllamaModel, OpenAICompatibleModel, checkEndpoint, checkGitUrl, GitSource, LocalDirectorySource, connectorsFromEnv } from '../src/index.ts';

const FIXTURE = new URL('../../../fixtures/combat-game', import.meta.url).pathname;
const hero = { name: 'hero', hp: 10, attack: 7, armor: 1 };
const slime = { name: 'slime', hp: 5, attack: 2, armor: 2 };

test('sandbox run arguments enforce isolation', () => {
  const args = new OciSandbox().runArgs({ workdir: tmpdir(), command: ['node', 'x'], timeoutMs: 5000, memoryMb: 128 }, 'n1');
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pull=never', '--user=65534:65534', '--memory=128m']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.ok(args.some(a => a.endsWith(',dst=/app,readonly')));
  assert.ok(args.includes('--env=HTTPS_PROXY='));
});

test('disabled and unreachable sandboxes fail closed', async () => {
  assert.equal((await new DisabledSandbox().status()).available, false);
  const broken = new OciSandbox({ host: 'unix:///nonexistent/docker.sock' });
  assert.equal((await broken.status()).available, false);
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: broken, model: null, sources: [new LocalDirectorySource()] });
  const { project } = await studio.addProject({ kind: 'local', ref: FIXTURE });
  const entry = studio.addEntry(project.id, 'src/game.ts#playTurn');
  await assert.rejects(studio.execute(project.id, entry.id, [hero, slime]), SandboxUnavailableError);
});

const docker = new OciSandbox();
const dockerReady = (await docker.status()).available;
const required = process.env.RUN_MINDMELD_SANDBOX === '1';

test('real Docker sandbox: trace recorded, network and source writes blocked', { skip: !dockerReady && !required && 'docker sandbox unavailable (set RUN_MINDMELD_SANDBOX=1 to require it)' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-oci-'));
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(join(dir, 'src/probe.ts'), `import { writeFileSync } from 'node:fs';
export async function probeNetwork(): Promise<string> {
  try { await fetch('http://1.1.1.1', { signal: AbortSignal.timeout(2000) }); return 'network reachable'; } catch { return 'network blocked'; }
}
export function probeWrite(): string {
  try { writeFileSync('/app/src/game.js', 'pwned'); return 'source writable'; } catch { return 'source read-only'; }
}
export function spin(): number { for (;;) { /* runaway */ } }
`);
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: docker, model: null, sources: [new LocalDirectorySource()] });
  const { project } = await studio.addProject({ kind: 'local', ref: dir });
  const play = studio.addEntry(project.id, 'src/game.ts#playTurn');
  const { run, events } = await studio.execute(project.id, play.id, [hero, slime]);
  assert.equal(run.status, 'ok', run.error ?? run.stdout);
  assert.equal(run.sandbox.connector, 'docker-oci');
  assert.match(run.runtimeVersion, /^v\d+/);
  assert.equal(events.length, 5);
  const net = await studio.execute(project.id, studio.addEntry(project.id, 'src/probe.ts#probeNetwork').id, []);
  assert.equal(JSON.parse(net.run.output), 'network blocked');
  const write = await studio.execute(project.id, studio.addEntry(project.id, 'src/probe.ts#probeWrite').id, []);
  assert.equal(JSON.parse(write.run.output), 'source read-only');
  const spin = await studio.execute(project.id, studio.addEntry(project.id, 'src/probe.ts#spin').id, [], { timeoutMs: 2000 });
  assert.equal(spin.run.status, 'timeout');
  assert.equal(readFileSync(join(dir, 'src/game.ts'), 'utf8').includes('pwned'), false);
});

function fakeServer(routes: Record<string, (body: unknown) => unknown>): Promise<{ server: Server; url: string }> {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += String(c); });
      req.on('end', () => {
        const handler = routes[`${req.method} ${req.url}`];
        if (!handler) { res.statusCode = 404; res.end('{}'); return; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(handler(data ? JSON.parse(data) : null)));
      });
    }).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
  });
}

test('Ollama and OpenAI-compatible connectors speak their protocols', async () => {
  const seen: unknown[] = [];
  const { server, url } = await fakeServer({
    'GET /api/tags': () => ({ models: [{ name: 'qwen2.5-coder:7b' }] }),
    'POST /api/chat': b => { seen.push(b); return { message: { content: 'hi [S:a#b]' } }; },
    'GET /v1/models': () => ({ data: [{ id: 'local-model' }] }),
    'POST /v1/chat/completions': () => ({ choices: [{ message: { content: 'ok' } }] }),
  });
  try {
    const ollama = new OllamaModel({ endpoint: url, model: 'qwen2.5-coder' });
    assert.equal((await ollama.status()).available, true);
    assert.equal(await ollama.chat([{ role: 'user', content: 'q' }]), 'hi [S:a#b]');
    assert.equal((seen[0] as { stream: boolean }).stream, false);
    assert.equal((await new OllamaModel({ endpoint: url, model: 'llama3' }).status()).available, false);
    const oai = new OpenAICompatibleModel({ endpoint: url, model: 'local-model' });
    assert.equal((await oai.status()).available, true);
    assert.equal(await oai.chat([{ role: 'user', content: 'q' }]), 'ok');
  } finally { server.close(); }
  assert.equal((await new OllamaModel({ endpoint: 'http://127.0.0.1:1', model: 'x' }).status()).available, false);
});

test('model endpoints must be local unless explicitly allowed', () => {
  assert.throws(() => checkEndpoint('https://api.example.com'), /not local/);
  assert.throws(() => checkEndpoint('http://user:pw@127.0.0.1:1'), /credentials/);
  assert.equal(checkEndpoint('http://ollama:11434', ['ollama']).hostname, 'ollama');
});

test('git source: https only, no credentials, hooks disabled, clones a real repo', async () => {
  assert.throws(() => checkGitUrl('ssh://git@host/x.git'), /https/);
  assert.throws(() => checkGitUrl('ext::sh -c touch% /tmp/pwned'), /./);
  assert.throws(() => checkGitUrl('https://tok@github.com/a/b.git'), /credentials/);
  assert.throws(() => checkGitUrl('file:///tmp/x'), /https/);
  const origin = mkdtempSync(join(tmpdir(), 'mm-git-'));
  cpSync(FIXTURE, origin, { recursive: true });
  const git = (...args: string[]) => spawnSync('git', ['-C', origin, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const source = new GitSource({ cacheDir: mkdtempSync(join(tmpdir(), 'mm-cache-')), allowFileProtocol: true });
  const { root, name } = await source.materialize(`file://${origin}`);
  assert.ok(readFileSync(join(root, 'src/game.ts'), 'utf8').includes('playTurn'));
  assert.ok(name.startsWith('mm-git-'));
});

test('local source honours allowed roots', async () => {
  await assert.rejects(new LocalDirectorySource([FIXTURE]).materialize('/etc'), /outside/);
  assert.ok((await new LocalDirectorySource([FIXTURE]).materialize(join(FIXTURE, 'src'))).root.endsWith('src'));
});

test('environment config builds fail-closed defaults', () => {
  const none = connectorsFromEnv({ MINDMELD_SANDBOX: 'none', MINDMELD_MODEL_PROVIDER: 'none' }, tmpdir());
  assert.equal(none.sandbox.name, 'disabled');
  assert.equal(none.model, null);
  const remote = connectorsFromEnv({ MINDMELD_MODEL_ENDPOINT: 'https://api.example.com' }, tmpdir());
  assert.equal(remote.model, null);
  assert.match(remote.notes[0], /not local/);
});
