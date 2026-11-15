import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, Studio, type CodeSymbol, type Graph, type StaticEdge } from '@mindmeld/core';
import { LocalDirectorySource } from '@mindmeld/connectors';
import { validateSpec } from '../../../scripts/explorer-spec.ts';
import { explorerSpec } from '../src/explorer.ts';
import { HostProcessSandbox, copyFixture } from '../../core/test/helpers.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;

async function fixtureGraph(): Promise<Graph> {
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model: null, sources: [new LocalDirectorySource()] });
  const { project } = await studio.addProject({ kind: 'local', ref: copyFixture() });
  return studio.graph(project.id);
}

test('a small repo maps file by file, with a flow across three modules and no name-match guesses', async () => {
  const spec = explorerSpec(await fixtureGraph());
  assert.deepEqual(validateSpec(spec), []);
  assert.deepEqual(spec.lanes.map(l => l.id), ['src']);
  assert.ok(Object.keys(spec.nodes).every(id => id.startsWith('src/') && id.endsWith('.ts')), 'nodes are files');
  assert.match(spec.nodes['src/game.ts'].role, /Calls into src\/combat\.ts/);
  const steps = spec.flows?.[0].steps ?? [];
  assert.deepEqual(steps.map(([from, to]) => `${from}>${to}`).slice(0, 2), ['src/game.ts>src/combat.ts', 'src/combat.ts>src/damage.ts']);
  assert.ok(steps.every(([, to]) => to !== 'src/save.ts'), 'the name-matched call to MemorySave.write is not drawn');
});

function syntheticGraph(files: string[]): Graph {
  const symbols: CodeSymbol[] = files.map(file => ({ id: `${file}#f`, name: 'f', kind: 'function', exported: true, async: false, params: [], span: { file, startLine: 1, endLine: 2 }, fileHash: 'h' }));
  const staticEdges: StaticEdge[] = symbols.slice(1).map((s, i) => ({ provenance: 'static', from: symbols[i].id, to: s.id, kind: 'call', resolution: 'import', site: { file: symbols[i].span.file, startLine: 1, endLine: 1 } }));
  return {
    project: { id: 'prj_0', name: 'Big Repo', sourceKind: 'local', sourceRef: '/r', root: '/r', createdAt: '' },
    snapshot: { id: 'snp_0', projectId: 'prj_0', snapshotHash: 'a'.repeat(64), createdAt: '', indexerVersion: 'v', files: [], skipped: [] },
    symbols, staticEdges, observedEdges: [], imports: [], staleRuns: 0,
  } as Graph;
}

test('a large repo splits the busiest directories first and stays within the page limits', () => {
  const files = [
    ...Array.from({ length: 200 }, (_, i) => `core/sub${i % 10}/f${i}.ts`),
    ...Array.from({ length: 30 }, (_, i) => `tools/t${i}.ts`),
    ...Array.from({ length: 12 }, (_, i) => `x${i}/a.ts`),
  ];
  const spec = explorerSpec(syntheticGraph(files));
  assert.deepEqual(validateSpec(spec), []);
  const ids = Object.keys(spec.nodes);
  assert.ok(ids.length <= 24, `${ids.length} nodes`);
  assert.ok(ids.includes('core/sub0'), 'the busiest directory is split into its subdirectories');
  assert.ok(ids.includes('tools'), 'smaller directories stay whole');
  assert.ok(spec.lanes.length <= 8 && spec.lanes.some(l => l.id === 'other'), 'lanes past the limit merge into other');
  assert.equal(spec.nodes['core/sub0'].lane, 'core');
});

test('root-level files share one lane; a single-symbol repo is a valid one-node page', () => {
  const small = explorerSpec(syntheticGraph(['index.ts', 'cli.ts', 'lib/a.ts']));
  assert.deepEqual(small.lanes.map(l => l.id), ['.', 'lib']);
  assert.equal(small.nodes['index.ts'].lane, '.');
  const one = explorerSpec(syntheticGraph(['only.ts']));
  assert.deepEqual(validateSpec(one), []);
  assert.deepEqual([Object.keys(one.nodes), one.start?.node, one.flows], [['only.ts'], 'only.ts', undefined]);
});

test('a repo without symbols is refused with a reason', () => {
  assert.throws(() => explorerSpec(syntheticGraph([])), /no indexed symbols to map/);
});

test('mindmeld explorer PATH writes the spec and a self-contained page', () => {
  const out = mkdtempSync(join(tmpdir(), 'mm-explorer-'));
  const r = spawnSync(process.execPath, [CLI, 'explorer', copyFixture(), '--data', mkdtempSync(join(tmpdir(), 'mm-explorer-data-')), '--out', out],
    { encoding: 'utf8', env: { ...process.env, MINDMELD_SANDBOX: 'none', MINDMELD_MODEL_PROVIDER: 'none' } });
  assert.equal(r.status, 0, r.stderr);
  const written = readdirSync(out).sort();
  assert.equal(written.length, 2);
  assert.match(written[0], /\.explorer\.html$/);
  assert.match(written[1], /\.explorer\.json$/);
  const page = readFileSync(join(out, written[0]), 'utf8');
  assert.match(page, /<title>[^<]+: code map<\/title>/);
  assert.doesNotMatch(page, /<script[^>]+src=/, 'no external scripts');
});
