import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Answer, CodeSymbol, ObservedEdge, ResolvedCitation, RunDiff, StaticEdge, TraceEvent } from '../../client/src/index.ts';
import { fileSlots, layers, layoutSymbols, ROW_HEIGHT } from '../src/lib/layout.ts';
import { mapEdges, edgeKey } from '../src/lib/edges.ts';
import { callStack, clampStep, pathUpTo } from '../src/lib/replay.ts';
import { checkInputs, inputTemplate } from '../src/lib/inputs.ts';
import { answerView, citationTone, parseEventRef, resolvedIndex, segments } from '../src/lib/answer.ts';
import { compareRows, shortSymbol } from '../src/lib/diff.ts';
import { duration, pretty, shortHash } from '../src/lib/format.ts';

const sym = (id: string, line = 1): CodeSymbol => ({
  id, name: shortSymbol(id), kind: 'function', exported: true, async: false, params: [],
  span: { file: id.split('#')[0], startLine: line, endLine: line + 2 }, fileHash: 'h',
});
const stat = (from: string, to: string, resolution: StaticEdge['resolution'] = 'import'): StaticEdge =>
  ({ provenance: 'static', from, to, kind: 'call', resolution, site: { file: 'x', startLine: 1, endLine: 1 } });
const obs = (from: string, to: string, count = 1): ObservedEdge => ({ provenance: 'observed', from, to, runIds: ['run_1'], count });
const ev = (seq: number, symbol: string, parent: number | null): TraceEvent => ({
  runId: 'run_1', seq, symbol, parent, depth: 0, args: '[]', result: '1', threw: false, async: false,
  thisBefore: null, thisAfter: null, startMs: seq, durationMs: 1,
});

test('layering puts callees right of callers and survives cycles', () => {
  const l = layers(['a', 'b', 'c', 'd'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }, { from: 'c', to: 'b' }]);
  assert.equal(l.get('a'), 0);
  assert.ok(l.get('c')! > l.get('b')!);
  assert.equal(l.get('d'), 0);
});

test('layout groups a column by file and assigns stable file colours', () => {
  const symbols = [sym('b.ts#y', 5), sym('a.ts#x'), sym('a.ts#z', 9)];
  const pos = layoutSymbols(symbols, []);
  assert.equal(pos.get('a.ts#x')!.y, 0);
  assert.equal(pos.get('a.ts#z')!.y, ROW_HEIGHT);
  assert.ok(pos.get('b.ts#y')!.y > 2 * ROW_HEIGHT, 'a file gap separates groups');
  assert.deepEqual([...fileSlots(symbols, 2)], [['a.ts', 0], ['b.ts', 1]]);
});

test('static edges are never styled as observed; filters and replay path apply', () => {
  const visible = new Set(['g#play', 'c#attack', 'c#legacy']);
  const staticEdges = [stat('g#play', 'c#attack'), stat('c#attack', 'c#legacy', 'local'), stat('g#play', 'c#attack')];
  const observedEdges = [obs('g#play', 'c#attack', 3)];
  const both = mapEdges({ staticEdges, observedEdges, mode: 'both', visible, path: new Set([edgeKey('g#play', 'c#attack')]) });
  assert.equal(both.length, 3, 'duplicate static call sites collapse');
  for (const e of both.filter(x => x.provenance === 'static')) {
    assert.match(e.className, /^edge-static static-/);
    assert.doesNotMatch(e.className, /observed|on-path/);
    assert.equal(e.animated, false);
  }
  const seen = both.find(e => e.provenance === 'observed')!;
  assert.equal(seen.label, '×3');
  assert.match(seen.className, /edge-observed on-path/);
  assert.equal(both.find(e => e.target === 'c#legacy')!.label, 'local');
  assert.deepEqual(mapEdges({ staticEdges, observedEdges, mode: 'observed', visible, path: new Set() }).map(e => e.provenance), ['observed']);
  assert.equal(mapEdges({ staticEdges, observedEdges, mode: 'static', visible: new Set(['g#play']), path: new Set() }).length, 0);
});

test('call stack walks parents and the observed path grows with the step', () => {
  const events = [ev(0, 'g#play', null), ev(1, 'c#attack', 0), ev(2, 'd#dmg', 1), ev(3, 's#write', 0)];
  assert.deepEqual(callStack(events, 2).map(e => e.symbol), ['g#play', 'c#attack', 'd#dmg']);
  assert.deepEqual(callStack(events, 3).map(e => e.seq), [0, 3]);
  assert.deepEqual([...pathUpTo(events, 1)], [edgeKey('g#play', 'c#attack')]);
  assert.equal(pathUpTo(events, 3).size, 3);
  assert.equal(clampStep(9, 4), 3);
  assert.equal(clampStep(-1, 0), 0);
});

test('run inputs must be a JSON array', () => {
  assert.deepEqual(checkInputs('[1, {"a": 2}]'), { ok: true, value: [1, { a: 2 }] });
  const notArray = checkInputs('{"a": 1}');
  assert.equal(notArray.ok, false);
  assert.match(checkInputs('[1,').ok ? '' : (checkInputs('[1,') as { error: string }).error, /Not valid JSON/);
  assert.equal(inputTemplate(['a', 'b']), '[null,null]');
});

const cite = (kind: 'symbol' | 'event', ref: string, valid: boolean, freshness: ResolvedCitation['freshness']): ResolvedCitation =>
  ({ kind, ref, valid, freshness, span: null, fileHash: null, label: ref });

test('answer view separates unsupported sentences and flags invalid or stale citations', () => {
  const answer: Answer = {
    question: 'q', abstained: false, text: 'x', model: 'm', usage: null, unknowns: [], assumptions: [],
    sentences: [
      { text: 'playTurn attacks [S:g.ts#play].', citations: ['S:g.ts#play'], supported: true },
      { text: 'It deletes the database [S:nope].', citations: ['S:nope'], supported: false },
    ],
    citations: [cite('symbol', 'g.ts#play', true, 'fresh'), cite('symbol', 'nope', false, 'missing'), cite('event', 'run_1#2', true, 'stale')],
  };
  const view = answerView(answer);
  assert.equal(view.supported.length, 1);
  assert.equal(view.unsupported[0].text, 'It deletes the database [S:nope].');
  assert.deepEqual(view.invalidCitations.map(c => c.ref), ['nope']);
  assert.deepEqual(view.staleCitations.map(c => c.ref), ['run_1#2']);
  const segs = segments('A [S:g.ts#play] and [E:run_1#2] end', resolvedIndex(answer));
  assert.deepEqual(segs.map(s => s.kind), ['text', 'cite', 'text', 'cite', 'text']);
  const tones = segs.flatMap(s => (s.kind === 'cite' ? [citationTone(s.resolved)] : []));
  assert.deepEqual(tones, ['fresh', 'stale']);
  assert.equal(citationTone(null), 'invalid');
  assert.deepEqual(parseEventRef('run_1#2'), { runId: 'run_1', seq: 2 });
  assert.equal(parseEventRef('run_1#x'), null);
});

test('diff rows pair events and mark the first divergence', () => {
  const ea = [ev(0, 'g#play', null), ev(1, 'c#attack', 0)];
  const eb = [ev(0, 'g#play', null), ev(1, 'c#attack', 0), ev(2, 'c#legacy', 1)];
  const diff: RunDiff = {
    a: 'run_a', b: 'run_b', sameSnapshot: true, outputA: '1', outputB: '2', statusA: 'ok', statusB: 'ok',
    rows: [{ symbol: 'g#play', a: 0, b: 0, sameValues: false }, { symbol: 'c#attack', a: 1, b: 1, sameValues: true }, { symbol: 'c#legacy', a: null, b: 2, sameValues: false }],
    firstDivergence: 0, onlyInA: [], onlyInB: ['c#legacy'],
  };
  const rows = compareRows(diff, ea, eb);
  assert.deepEqual(rows.map(r => r.change), ['values', 'same', 'only-b']);
  assert.equal(rows[0].first, true);
  assert.equal(rows[2].a, null);
  assert.equal(rows[2].b?.symbol, 'c#legacy');
});

test('formatters', () => {
  assert.equal(duration(0.2), '<1 ms');
  assert.equal(duration(12.4), '12 ms');
  assert.equal(duration(1500), '1.50 s');
  assert.equal(shortHash('abcdef0123456789'), 'abcdef0123');
  assert.equal(pretty('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(pretty('not json'), 'not json');
});
