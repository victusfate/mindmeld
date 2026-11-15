import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EvidenceStore, Studio } from '@mindmeld/core';
import { LocalDirectorySource } from '@mindmeld/connectors';
import { McpServer, PROTOCOL_VERSIONS, type Tool } from '../src/mcp/protocol.ts';
import { ProjectTools } from '../src/mcp/tools.ts';
import { HostProcessSandbox, copyFixture } from '../../core/test/helpers.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const EXIT_TIMEOUT_MS = 30_000;

/** Feeds `lines` to a server and collects every reply until the input ends. */
async function converse(server: McpServer, lines: unknown[]): Promise<any[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', c => { text += String(c); });
  const done = server.serve(input, output);
  for (const l of lines) input.write(typeof l === 'string' ? `${l}\n` : `${JSON.stringify(l)}\n`);
  input.end();
  await done;
  return text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

test('protocol: version negotiation, ping, tools, errors, notifications', async () => {
  const echo: Tool = { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} }, run: a => String(a.text) };
  let boomRuns = 0;
  const boom: Tool = { name: 'boom', description: 'fails', inputSchema: { type: 'object', properties: {} }, run: () => { boomRuns += 1; throw new Error('bad input'); } };
  const server = new McpServer({ name: 'mindmeld', version: '0.0.0' }, [echo, boom]);
  const replies = await converse(server, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
    { jsonrpc: '2.0', id: 4, method: 'tools/list' },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom' } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } },
    { jsonrpc: '2.0', id: 8, method: 'resources/list' },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'boom' } },
    { jsonrpc: '2.0', id: null, method: 'ping' },
    'not json',
  ]);
  const byId = new Map(replies.map(r => [r.id, r]));
  assert.equal(replies.length, 10, 'notifications get no reply (and run nothing); requests, the null id and the parse error do');
  assert.equal(byId.get(1).result.protocolVersion, '2025-06-18');
  assert.deepEqual(byId.get(1).result.capabilities, { tools: {} });
  assert.equal(byId.get(2).result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.deepEqual(byId.get(3).result, {});
  assert.deepEqual(byId.get(4).result.tools.map((t: Tool) => t.name), ['echo', 'boom']);
  assert.equal(byId.get(4).result.tools[0].run, undefined, 'only the tool description goes out');
  assert.deepEqual(byId.get(5).result.content, [{ type: 'text', text: 'hi' }]);
  assert.equal(byId.get(6).result.isError, true);
  assert.equal(byId.get(6).result.content[0].text, 'bad input');
  assert.equal(boomRuns, 1, 'a tools/call notification runs nothing');
  assert.equal(byId.get(7).error.code, -32602);
  assert.equal(byId.get(8).error.code, -32601);
  assert.deepEqual(replies.filter(r => r.id === null).map(r => r.error.code), [-32600, -32700], 'a null request id is invalid');
});

test('tools answer from the index: overview, search, symbol, outline, refresh', async () => {
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model: null, sources: [new LocalDirectorySource()] });
  const repo = copyFixture();
  const { project } = await studio.addProject({ kind: 'local', ref: repo });
  const tools = new ProjectTools(studio, project.id);
  const call = (name: string, args: Record<string, unknown> = {}): Promise<string> | string => tools.list().find(t => t.name === name)!.run(args);

  const overview = await call('overview');
  assert.match(overview, /files: \d+ \(typescript \d+/);
  assert.match(overview, /static call edges: \d+ \(.*local/);
  assert.match(overview, /most-called symbols/);

  const found = await call('find_symbols', { query: 'playturn' });
  assert.match(found.split('\n')[1], /^src\/game\.ts#playTurn {2}function exported {2}src\/game\.ts:\d+-\d+$/, 'an exact name ranks first');
  assert.match(await call('find_symbols', { query: 'zzz' }), /no symbols match/);
  assert.match(await call('find_symbols', { query: 'a', limit: 2 }), /\(first 2\)/);
  await assert.rejects(async () => call('find_symbols', { query: '' }), /query must be a non-empty string/);

  const symbol = await call('symbol', { id: 'src/game.ts#playTurn' });
  assert.match(symbol, /export function playTurn/, 'includes the source');
  assert.match(symbol, /static callees \(\d+\):\n {2}src\/combat\.ts#attack \(import, src\/game\.ts:\d+\)/);
  assert.match(symbol, /static callers \(1\):\n {2}src\/game\.ts#playTurnLater \(local/);
  await assert.rejects(async () => call('symbol', { id: 'src/x.ts#nope' }), /use find_symbols/);

  assert.match(await call('file_symbols', { path: './src/damage.ts' }), /^src\/damage\.ts#computeDamage/);
  assert.match(await call('file_symbols', { path: 'nope.ts' }), /not in the snapshot/);
  writeFileSync(join(repo, 'src/extra.ts'), 'export function addedLater(): number { return 1; }\n');
  assert.match(await call('refresh'), /^snapshot [0-9a-f]{12} · \d+ files/);
  assert.match(await call('find_symbols', { query: 'addedLater' }), /src\/extra\.ts#addedLater/, 'the index is rebuilt after a refresh');
});

test('mindmeld mcp PATH speaks MCP on stdout, logs on stderr, and exits when the agent closes stdin', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mm-mcp-'));
  const child = spawn(process.execPath, [CLI, 'mcp', copyFixture(), '--data', data], {
    env: { ...process.env, MINDMELD_SANDBOX: 'none', MINDMELD_MODEL_PROVIDER: 'none' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', c => { out += String(c); });
  child.stderr.on('data', c => { err += String(c); });
  const exited = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no exit within ${EXIT_TIMEOUT_MS} ms\n${err}`)); }, EXIT_TIMEOUT_MS);
    child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find_symbols', arguments: { query: 'attack' } } })}\n`);
  child.stdin.end();
  assert.equal(await exited, 0, err);
  const replies = out.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(replies.length, 2, 'stdout carries only protocol messages');
  assert.equal(replies[0].result.serverInfo.name, 'mindmeld');
  assert.match(replies[1].result.content[0].text, /src\/combat\.ts#attack/);
  assert.match(err, /imported /, 'progress goes to stderr');
});
