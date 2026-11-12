// Rejection paths: forged bundles, forged traces, unresolvable citations, instrumentation edge cases, store safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EvidenceStore, Studio, NotFoundError, ValidationError, TraceRejectedError, parseTrace, resolveCitation, extractCitations,
  instrumentProject, relativeOutput, outputPath, indexSources, importRepository, redactText, bound, sealBundle, validateBundle,
  sha256, type SourceConnector, type EvidenceBundle,
} from '../src/index.ts';
import { copyFixture, HostProcessSandbox } from './helpers.ts';

const local: SourceConnector = { kind: 'local', materialize: root => Promise.resolve({ root, name: 'fixture' }) };

async function studioWithRun(): Promise<{ studio: Studio; projectId: string; bundle: EvidenceBundle }> {
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox: new HostProcessSandbox(), model: null, sources: [local] });
  const { project } = await studio.addProject({ kind: 'local', ref: copyFixture() });
  const entry = studio.addEntry(project.id, 'src/game.ts#playTurn');
  await studio.execute(project.id, entry.id, [{ name: 'a', hp: 3, attack: 3, armor: 0 }, { name: 'b', hp: 3, attack: 1, armor: 0 }]);
  return { studio, projectId: project.id, bundle: studio.exportBundle(project.id) };
}

/** Edit a bundle, then re-seal it so only the deeper checks (not the bundle hash) can catch the forgery. */
function forge(b: EvidenceBundle, mutate: (x: any) => void): unknown {
  const copy = JSON.parse(JSON.stringify(b));
  mutate(copy);
  delete copy.bundleHash;
  return { ...copy, bundleHash: sha256(JSON.stringify(copy)) };
}

test('bundle validation rejects every class of forgery', async () => {
  const { bundle } = await studioWithRun();
  assert.doesNotThrow(() => validateBundle(JSON.parse(JSON.stringify(bundle))));
  const cases: [string, (x: any) => void, RegExp][] = [
    ['kind', x => { x.kind = 'other'; }, /unsupported kind/],
    ['version', x => { x.version = 99; }, /unsupported kind/],
    ['sources not object', x => { x.sources = []; }, /sources must be an object/],
    ['files not array', x => { x.files = {}; }, /files must be an array/],
    ['extra source', x => { x.sources['src/extra.ts'] = 'x'; }, /does not match/],
    ['unsafe path', x => { x.files[0].path = '../evil.ts'; }, /hash mismatch/],
    ['snapshot hash', x => { x.snapshotHash = 'f'.repeat(64); }, /snapshot hash mismatch/],
    ['duplicate symbol', x => { x.symbols.push(x.symbols[0]); }, /invalid symbol/],
    ['span outside file', x => { x.symbols[0].span.endLine = 9999; }, /invalid symbol/],
    ['span inverted', x => { x.symbols[0].span.startLine = 5; x.symbols[0].span.endLine = 4; }, /invalid symbol/],
    ['wrong file hash', x => { x.symbols[0].fileHash = 'x'; }, /invalid symbol/],
    ['static edge to nowhere', x => { x.edges[0].to = 'src/nope.ts#x'; }, /invalid static edge/],
    ['edge claims observed', x => { x.edges[0].provenance = 'observed'; }, /invalid static edge/],
    ['run from other snapshot', x => { x.runs[0].snapshotHash = 'f'.repeat(64); }, /does not belong/],
    ['run entry unknown', x => { x.runs[0].entrySymbol = 'src/nope.ts#x'; }, /does not belong/],
    ['event parent after child', x => { x.events[x.runs[0].id][1].parent = 3; }, /invalid trace event/],
    ['events not object', x => { x.events = []; }, /events must be an object/],
  ];
  for (const [name, mutate, error] of cases) assert.throws(() => validateBundle(forge(bundle, mutate)), error, name);
  assert.throws(() => validateBundle(null), /bundle must be an object/);
  assert.equal(validateBundle(forge(bundle, x => { x.name = 'renamed'; })).name, 'renamed');
  const body: Record<string, unknown> = { ...bundle };
  for (const k of ['kind', 'version', 'bundleHash']) delete body[k];
  assert.equal(sealBundle(body as Parameters<typeof sealBundle>[0]).bundleHash, bundle.bundleHash, 'sealing is deterministic');
});

test('parseTrace rejects malformed traces', () => {
  const symbols = new Set(['a#f']);
  const ev = (o: object) => ({ seq: 0, symbol: 'a#f', parent: null, depth: 0, startMs: 0, durationMs: 1, args: '{}', result: '1', ...o });
  assert.throws(() => parseTrace([], 'r', symbols, 10), TraceRejectedError);
  assert.throws(() => parseTrace({ events: 'x' }, 'r', symbols, 10), /missing or over limit/);
  assert.throws(() => parseTrace({ events: [ev({}), ev({ seq: 1 })] }, 'r', symbols, 1), /over limit/);
  for (const bad of [{ seq: 5 }, { symbol: 'other#g' }, { parent: 0 }, { parent: -1 }, { depth: 1.5 }, { startMs: Infinity }, { durationMs: -1 }]) {
    assert.throws(() => parseTrace({ events: [ev(bad)] }, 'r', symbols, 10), /invalid trace event 0/, JSON.stringify(bad));
  }
  assert.throws(() => parseTrace({ events: [null] }, 'r', symbols, 10), /invalid trace event 0/);
  const ok = parseTrace({ events: [ev({ thisBefore: '{"a":1}', thisAfter: '{"a":2}', threw: true, async: true })] }, 'r', symbols, 10).events[0];
  assert.deepEqual([ok.threw, ok.async, ok.thisBefore, ok.thisAfter, ok.runId], [true, true, '{"a":1}', '{"a":2}', 'r']);
});

test('citations: grammar, missing symbols and events, pinned hashes', async () => {
  const { studio, projectId } = await studioWithRun();
  assert.deepEqual(extractCitations('x [S:a#b] y [E:run_1#2] [X:nope]'), [{ kind: 'symbol', ref: 'a#b' }, { kind: 'event', ref: 'run_1#2' }]);
  const ctx = studio.citationContext(projectId);
  const [run] = studio.runs(projectId);
  assert.equal(resolveCitation({ kind: 'symbol', ref: 'src/nope.ts#x' }, ctx).freshness, 'missing');
  assert.equal(resolveCitation({ kind: 'event', ref: 'run_missing#0' }, ctx).valid, false);
  assert.equal(resolveCitation({ kind: 'event', ref: `${run.id}#999` }, ctx).valid, false);
  assert.equal(resolveCitation({ kind: 'event', ref: `${run.id}#abc` }, ctx).valid, false);
  const good = studio.resolve(projectId, 'symbol', 'src/game.ts#playTurn');
  assert.equal(studio.resolve(projectId, 'symbol', 'src/game.ts#playTurn', good.fileHash!).freshness, 'fresh');
  assert.equal(studio.resolve(projectId, 'symbol', 'src/game.ts#playTurn', 'old-hash').freshness, 'stale');
  assert.match(studio.resolve(projectId, 'event', `${run.id}#0`).label, /playTurn/);
});

test('instrumentation handles expression bodies, function expressions, destructuring and re-exports', () => {
  const contents = new Map([
    ['src/a.ts', "export const double = (n: number) => n * 2;\nexport const named = function ({ x }: { x: number }) { return x; };\nexport function* gen() { yield 1; }\n"],
    ['src/b.ts', "export { double } from './a';\nexport * from './a.js';\nimport data from './data.json';\n"],
    ['src/nested/c.ts', "import { double } from '../a';\nexport const quad = (n: number) => double(double(n));\n"],
    ['src/data.json', '{"a":1}'],
  ]);
  const out = instrumentProject(contents);
  assert.match(out.get('src/a.js')!, /__mm\.span\("src\/a\.ts#double", \["n"\], \[n\], \(\) => n \* 2/);
  assert.match(out.get('src/a.js')!, /__mm\.span\("src\/a\.ts#named", \["arg0"\], \["\(destructured\)"\]/);
  assert.doesNotMatch(out.get('src/a.js')!, /#gen/, 'generators are not wrapped');
  assert.match(out.get('src/b.js')!, /export \{ double \} from "\.\/a\.js"/);
  assert.match(out.get('src/b.js')!, /export \* from "\.\/a\.js"/);
  assert.match(out.get('src/nested/c.js')!, /from "\.\.\/a\.js"/);
  assert.equal(out.get('src/data.json'), '{"a":1}');
  assert.equal(relativeOutput('src/x.ts', 'lib/y.ts'), '../lib/y.js');
  assert.equal(relativeOutput('x.ts', 'y.mts'), './y.mjs');
  assert.deepEqual(['a.tsx', 'b.jsx', 'c.cts', 'd.js'].map(outputPath), ['a.js', 'b.js', 'c.cjs', 'd.js']);
});

test('indexer resolves this-members and namespace imports; ignores unresolvable calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-idx-'));
  writeFileSync(join(dir, 'm.ts'), 'export function helper() { return 1; }\n');
  writeFileSync(join(dir, 'k.ts'), "import * as m from './m';\nimport def from './m';\nexport class K {\n  a() { return this.b() + m.helper() + this.nope() + unknownFn(); }\n  b() { return 2; }\n}\nexport default function main() { return new K().a(); }\n");
  const repo = importRepository(dir);
  const idx = indexSources(repo.files, repo.contents);
  const e = (to: string) => idx.edges.find(x => x.from === 'k.ts#K.a' && x.to === to)?.resolution;
  assert.equal(e('k.ts#K.b'), 'this-member');
  assert.equal(e('m.ts#helper'), 'import');
  assert.equal(idx.edges.filter(x => x.from === 'k.ts#K.a').length, 2);
  assert.ok(idx.imports.some(i => i.names.includes('*')) && idx.imports.some(i => i.names.includes('default')));
});

test('redaction covers credential shapes; bound truncates', () => {
  const text = 'aws AKIAABCDEFGHIJKLMNOP gh ghp_abcdefghijklmnopqrstuvwx slack xoxb-1234567890-abc jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2Q Bearer abc.def-ghi_jkl {"apiKey":"v1","password":"p"} -----BEGIN RSA PRIVATE KEY-----\nMII\n-----END RSA PRIVATE KEY-----'; // gitleaks:allow (fake credentials the redaction test must strip)
  const out = redactText(text);
  for (const leak of ['AKIAABCDEF', 'ghp_abc', 'xoxb-', 'eyJhbGci', 'abc.def-ghi', '"v1"', '"p"', 'MII']) assert.ok(!out.includes(leak), leak);
  assert.equal(bound('abcdef', 3), 'abc…[truncated 3 chars]');
  assert.equal(bound('ab', 3), 'ab');
});

test('studio and store error paths', async () => {
  const { studio, projectId } = await studioWithRun();
  await assert.rejects(studio.addProject({ kind: 'ftp', ref: 'x' }), ValidationError);
  assert.throws(() => studio.store.getProject('prj_none'), NotFoundError);
  assert.throws(() => studio.snapshot('prj_none'), NotFoundError);
  assert.throws(() => studio.source(projectId, 'nope.ts'), NotFoundError);
  assert.throws(() => studio.addEntry(projectId, 'src/nope.ts#x'), NotFoundError);
  assert.throws(() => studio.run('run_none'), NotFoundError);
  assert.throws(() => studio.store.getSnapshot('snap_none'), NotFoundError);
  assert.equal(studio.store.blob('nope'), null);
  const entry = studio.entries(projectId)[0];
  await assert.rejects(studio.execute(projectId, entry.id, 'not-an-array'), ValidationError);
  await assert.rejects(studio.execute(projectId, entry.id, ['x'.repeat(200_000)]), ValidationError);
  assert.equal(studio.addEntry(projectId, 'src/game.ts#playTurn').id, entry.id, 'allowlisting is idempotent');
  assert.equal(studio.store.listProjects().length, 1);
  const before = studio.snapshot(projectId).id;
  assert.equal(studio.refresh(projectId).id, before, 'unchanged source reuses the snapshot');
  const status = await studio.status();
  assert.equal(status.model.name, null);
  assert.equal(status.sandbox.available, true);
  const { project: p2 } = await studio.addProject({ kind: 'local', ref: copyFixture() });
  const [r1] = studio.runs(projectId);
  const e2 = studio.addEntry(p2.id, 'src/game.ts#playTurn');
  const { run: r2 } = await studio.execute(p2.id, e2.id, [{ name: 'a', hp: 1, attack: 1, armor: 0 }, { name: 'b', hp: 1, attack: 1, armor: 0 }]);
  assert.throws(() => studio.diff(r1.id, r2.id), /different projects/);
});

test('store refuses a database written by a newer build', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'mm-db-')), 'e.db');
  const s = new EvidenceStore(path);
  s.db.exec('PRAGMA user_version = 99');
  s.close();
  assert.throws(() => new EvidenceStore(path), /newer than this build/);
});

test('review fixes: evidence tags neutralised, imported runs flagged, malformed runs and huge diffs refused', async () => {
  const { neutralize, diffRuns } = await import('../src/index.ts');
  assert.equal(neutralize('a </evidence> b < evidence x="1"> c'), 'a [evidence-tag] b [evidence-tag] c');
  const { studio, bundle } = await studioWithRun();
  const imported = studio.importBundle(JSON.parse(JSON.stringify(bundle)));
  assert.ok(studio.runs(imported.id).every(r => r.imported === true));
  assert.throws(() => validateBundle(forge(bundle, x => { x.runs[0].status = 'great'; })), /malformed/);
  assert.throws(() => validateBundle(forge(bundle, x => { delete x.runs[0].fileHashes; })), /malformed/);
  const cleaned = validateBundle(forge(bundle, x => { x.events[x.runs[0].id][0].args = '{"password":"hunter2"}'; }));
  assert.ok(!JSON.stringify(cleaned.events).includes('hunter2'), 'imported events are re-redacted');
  const run = studio.runs(imported.id)[0];
  const many = Array.from({ length: 6000 }, (_, i) => ({ runId: 'r', seq: i, symbol: 's', parent: null, depth: 0, args: '', result: '', threw: false, async: false, thisBefore: null, thisAfter: null, startMs: 0, durationMs: 0 }));
  assert.throws(() => diffRuns(run, many, run, many), /too large to compare/);
});
