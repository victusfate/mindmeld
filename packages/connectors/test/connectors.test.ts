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
  assert.match((await new CliModel({ provider: 'agy', command: bin }).status()).reason, /unverified/);
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
