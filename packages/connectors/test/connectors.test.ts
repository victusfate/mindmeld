import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, Studio, SandboxUnavailableError } from '@mindmeld/core';
import { OciSandbox, DisabledSandbox, CliModel, flattenMessages, parseClaude, parseCodex, checkGitUrl, GitSource, LocalDirectorySource, connectorsFromEnv } from '../src/index.ts';

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

const FAKE_CLI = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('fake-agent 1.0'); process.exit(0); }
let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  const out = args.indexOf('-o');
  const reply = JSON.stringify({ args, cwd: process.cwd(), token: process.env.MINDMELD_TOKEN ?? null, input });
  if (out >= 0) require('node:fs').writeFileSync(args[out + 1], reply); else process.stdout.write(reply);
});
`;

function fakeCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-cli-'));
  const bin = join(dir, 'fake-agent.cjs');
  writeFileSync(bin, FAKE_CLI, { mode: 0o755 });
  return bin;
}

test('agent CLI models: prompt on stdin, tools off, empty cwd, no Studio secrets', async () => {
  const bin = fakeCli();
  process.env.MINDMELD_TOKEN = 'secret-token';
  try {
    const claude = new CliModel({ provider: 'claude', command: bin, model: 'sonnet' });
    assert.equal((await claude.status()).available, true);
    const reply = JSON.parse((await claude.chat([{ role: 'system', content: 'rules' }, { role: 'user', content: 'question?' }])).text);
    assert.deepEqual(reply.args.slice(0, 2), ['--model', 'sonnet']);
    assert.ok(reply.args.includes('--tools') && reply.args[reply.args.indexOf('--tools') + 1] === '');
    assert.match(reply.input, /# Instructions\nrules[\s\S]*# Request\nquestion\?/);
    assert.equal(reply.token, null);
    assert.match(reply.cwd, /mindmeld-model-/);
    const codex = new CliModel({ provider: 'codex', command: bin });
    const viaFile = JSON.parse((await codex.chat([{ role: 'user', content: 'q' }])).text);
    assert.ok(viaFile.args.includes('--sandbox') && viaFile.args.includes('read-only'));
    assert.equal(viaFile.input, '# Request\nq');
  } finally { delete process.env.MINDMELD_TOKEN; }
  assert.equal((await new CliModel({ provider: 'pi', command: '/nonexistent/pi' }).status()).available, false);

  assert.equal(flattenMessages([{ role: 'assistant', content: 'a' }]), '# Previous answer\na');
});

test('CLI usage parsers read reported usage and leave the rest unknown', () => {
  const claude = parseClaude(JSON.stringify({ result: 'hi', total_cost_usd: 0.01, usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 5, cache_creation_input_tokens: 6 }, modelUsage: { 'm-1': {} } }), null);
  assert.deepEqual(claude, { text: 'hi', usage: { model: 'm-1', inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 6, costUsd: 0.01 }, limits: null });
  assert.deepEqual(parseClaude('plain text', null).usage.costUsd, null);
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: 1794582000, status: 'allowed' }, seven_day: { utilization: 0.48, status: 'allowed' } } } }),
    JSON.stringify({ type: 'result', result: 'ok', total_cost_usd: 0.02, usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { m: {} } }),
  ].join('\n');
  const streamed = parseClaude(stream, null);
  assert.equal(streamed.text, 'ok');
  assert.equal(streamed.usage.costUsd, 0.02);
  assert.deepEqual(streamed.limits, [
    { window: 'five_hour', utilization: 0.3, resetsAt: new Date(1794582000 * 1000).toISOString(), status: 'allowed' },
    { window: 'seven_day', utilization: 0.48, resetsAt: null, status: 'allowed' },
  ]);
  const codex = parseCodex(['{"type":"thread.started"}', '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":7}}'].join('\n'), 'answer');
  assert.equal(codex.text, 'answer');
  assert.deepEqual([codex.usage.inputTokens, codex.usage.outputTokens, codex.usage.cacheReadTokens, codex.usage.costUsd], [10, 7, 2, null]);
});

test('real claude CLI answers through the connector', { skip: process.env.RUN_MINDMELD_CLI_MODEL !== '1' && 'set RUN_MINDMELD_CLI_MODEL=1 to call the installed claude CLI' }, async () => {
  const model = new CliModel({ provider: 'claude' });
  assert.equal((await model.status()).available, true);
  const answer = await model.chat([{ role: 'system', content: 'Reply with exactly the word: pong' }, { role: 'user', content: 'ping' }]);
  assert.match(answer.text, /pong/i);
  assert.ok((answer.usage.outputTokens ?? 0) > 0, 'claude reports token usage');
  assert.ok(answer.usage.costUsd !== null && answer.usage.model !== null);
  assert.ok(answer.limits?.length, 'claude reports at least one plan window');
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
  const unknown = connectorsFromEnv({ MINDMELD_MODEL_PROVIDER: 'openai' }, tmpdir());
  assert.equal(unknown.model, null);
  assert.match(unknown.notes[0], /unknown provider/);
  const codex = connectorsFromEnv({ MINDMELD_MODEL_PROVIDER: 'codex' }, tmpdir());
  assert.equal(codex.model?.name, 'codex-cli');
});

test('environment config: sandbox kinds, provider selection, arg overrides, git toggle', () => {
  const env = (o: Record<string, string>) => connectorsFromEnv({ MINDMELD_MODEL_PROVIDER: 'none', ...o }, tmpdir());
  assert.equal(env({ MINDMELD_SANDBOX: 'podman' }).sandbox.name, 'podman-oci');
  assert.equal(env({}).sandbox.name, 'docker-oci');
  assert.equal(env({ MINDMELD_SANDBOX: 'firejail' }).sandbox.name, 'disabled');
  assert.equal(env({ MINDMELD_SANDBOX_IMAGE: 'mine:1' }).sandbox.image, 'mine:1');
  assert.deepEqual(env({}).sources.map(s => s.kind), ['local', 'git']);
  assert.deepEqual(env({ MINDMELD_GIT: 'off' }).sources.map(s => s.kind), ['local']);
  const badArgs = connectorsFromEnv({ MINDMELD_MODEL_PROVIDER: 'pi', MINDMELD_MODEL_ARGS: 'not json' }, tmpdir());
  assert.equal(badArgs.model?.name, 'pi-cli');
  assert.match(badArgs.notes[0], /not a JSON array/);
  const custom = connectorsFromEnv({ MINDMELD_MODEL_PROVIDER: 'agy', MINDMELD_MODEL_ARGS: '["run","--quiet"]', MINDMELD_MODEL_COMMAND: '/opt/agy' }, tmpdir());
  assert.equal(custom.model?.name, 'agy-cli');
  const auto = connectorsFromEnv({ MINDMELD_MODEL_PROVIDER: 'auto', PATH: '' }, tmpdir());
  assert.ok(auto.model === null || auto.model.name.endsWith('-cli'));
});

test('CLI model failures surface as errors, never as answers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-cli-fail-'));
  const bin = join(dir, 'failing.cjs');
  writeFileSync(bin, "#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('x'); process.exit(0); }\nprocess.stdin.resume(); process.stdin.on('end', () => { console.error('not logged in'); process.exit(3); });\n", { mode: 0o755 });
  await assert.rejects(new CliModel({ provider: 'claude', command: bin }).chat([{ role: 'user', content: 'q' }]), /exited 3: not logged in/);
  await assert.rejects(new CliModel({ provider: 'claude', command: join(dir, 'missing') }).chat([{ role: 'user', content: 'q' }]), /ENOENT/);
  const plain = await new CliModel({ provider: 'pi', command: fakeCli() }).chat([{ role: 'user', content: 'q' }]);
  assert.deepEqual(plain.usage, { model: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null });
});

test('local source rejects files; git rejects failed clones', async () => {
  await assert.rejects(new LocalDirectorySource().materialize(join(FIXTURE, 'package.json')), /must be a directory/);
  const git = new GitSource({ cacheDir: mkdtempSync(join(tmpdir(), 'mm-cache-')), allowFileProtocol: true });
  await assert.rejects(git.materialize(`file://${mkdtempSync(join(tmpdir(), 'mm-empty-'))}/nope`), /git clone failed/);
});

test('OCI sandbox refuses comma paths and records exit/timeout from a fake runtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-oci-fake-'));
  const bin = join(dir, 'fake-docker.cjs');
  writeFileSync(bin, "#!/usr/bin/env node\nconst a = process.argv.slice(2);\nif (a[0] === 'run') { console.log('out'); process.exit(a.includes('spin') ? 137 : 0); }\nprocess.exit(0);\n", { mode: 0o755 });
  const comma = mkdtempSync(join(tmpdir(), 'a,b-'));
  assert.throws(() => new OciSandbox().runArgs({ workdir: comma, command: ['x'], timeoutMs: 1000, memoryMb: 64 }, 'n'), /commas/);
  const box = new OciSandbox({ binary: bin as 'docker' });
  const ok = await box.run({ workdir: dir, command: ['node'], timeoutMs: 1000, memoryMb: 64 });
  assert.deepEqual([ok.exitCode, ok.timedOut, ok.stdout.trim()], [0, false, 'out']);
  const killed = await box.run({ workdir: dir, command: ['spin'], timeoutMs: 1000, memoryMb: 64 });
  assert.equal(killed.timedOut, true);
  await assert.rejects(new OciSandbox({ binary: join(dir, 'none') as 'docker' }).run({ workdir: dir, command: [], timeoutMs: 1000, memoryMb: 64 }), /failed to start/);
  await assert.rejects(new DisabledSandbox('off').run(), /execution unavailable: off/);
});

test('agent CLIs without a verified tools-off invocation are unavailable unless overridden', async () => {
  const bin = fakeCli();
  for (const provider of ['agy', 'pi'] as const) {
    const status = await new CliModel({ provider, command: bin }).status();
    assert.equal(status.available, false);
    assert.match(status.reason, /no verified way to disable its tools/);
    assert.equal((await new CliModel({ provider, command: bin, args: ['--no-tools', '-p'] }).status()).available, true);
  }
});

test('a CLI that exits 0 without writing its answer file is an error, not a crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-cli-nofile-'));
  const bin = join(dir, 'silent.cjs');
  writeFileSync(bin, "#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on('end', () => process.exit(0));\n", { mode: 0o755 });
  await assert.rejects(new CliModel({ provider: 'codex', command: bin }).chat([{ role: 'user', content: 'q' }]), /no readable answer/);
});
