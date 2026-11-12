// Unit tests for the vscode-free modules: wording, parsing, evidence counting, staleness and usage text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Answer, Graph, Run, UsageSummary } from '@mindmeld/client';
import { answerBodyHtml, citationTarget, escapeHtml, parseCitationToken } from '../src/answer.ts';
import { canAllowlist, evidenceFor, lensTitle, symbolAt } from '../src/evidence.ts';
import { argsValidationMessage, parseArgsJson, statusView } from '../src/input.ts';
import { loginUrl, parseConnectionInput, redactUrl } from '../src/login.ts';
import { fileFreshness, relativeFile, sha256Hex } from '../src/staleness.ts';
import { childEvents, runDescription } from '../src/trees.ts';
import { answerUsageLine, costText, usageReport, usageStatusText, usageTooltipLines } from '../src/usage.ts';

const span = (file: string, startLine: number, endLine: number) => ({ file, startLine, endLine });
const sym = (id: string, s = span('a.ts', 1, 3), exported = true) =>
  ({ id, name: id.split('#')[1], kind: 'function' as const, exported, async: false, params: [], span: s, fileHash: 'h' });
const graph: Pick<Graph, 'symbols' | 'staticEdges' | 'observedEdges'> = {
  symbols: [sym('a.ts#outer', span('a.ts', 1, 10)), sym('a.ts#inner', span('a.ts', 3, 5), false)],
  staticEdges: [{ provenance: 'static', from: 'a.ts#outer', to: 'a.ts#inner', kind: 'call', resolution: 'local', site: span('a.ts', 2, 2) }],
  observedEdges: [{ provenance: 'observed', from: 'a.ts#outer', to: 'a.ts#inner', runIds: ['r1', 'r2'], count: 3 }],
};
const totals = (over: Partial<UsageSummary['totals']> = {}) =>
  ({ count: 1, failed: 0, durationMs: 1000, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.5, unknownCost: 0, ...over });

test('login URL parsing keeps the token out of the base URL; redaction hides it', () => {
  assert.deepEqual(parseConnectionInput('http://127.0.0.1:8787/auth?token=abc'), { baseUrl: 'http://127.0.0.1:8787', token: 'abc' });
  assert.deepEqual(parseConnectionInput(' http://h:1/ '), { baseUrl: 'http://h:1', token: null });
  assert.equal(parseConnectionInput('ftp://x'), null);
  assert.equal(parseConnectionInput('nope'), null);
  assert.equal(loginUrl('http://h/', 'a b'), 'http://h/auth?token=a%20b');
  assert.equal(redactUrl('failed http://h/auth?token=secret&x=1'), 'failed http://h/auth?token=***&x=1');
});

test('run arguments must be a JSON array', () => {
  assert.deepEqual(parseArgsJson(''), { ok: true, value: [] });
  assert.deepEqual(parseArgsJson('[1,"a"]'), { ok: true, value: [1, 'a'] });
  assert.match(argsValidationMessage('{}')!, /JSON array/);
  assert.match(argsValidationMessage('[')!, /not valid JSON/);
});

test('evidence separates observed calls (fresh runs) from static (possible) callers', () => {
  const e = evidenceFor(graph, [], 'a.ts#inner');
  assert.deepEqual(e, { observedCalls: 3, observedRuns: 2, staticCallers: 1 });
  assert.equal(lensTitle(e), 'observed 3× in 2 fresh runs · 1 static caller (possible)');
  assert.equal(lensTitle(evidenceFor(graph, [], 'a.ts#outer')), 'no observed calls (static only) · no static callers');
  const runs = [{ id: 'r3', entrySymbol: 'a.ts#outer', stale: false }, { id: 'r4', entrySymbol: 'a.ts#outer', stale: true }] as Run[];
  assert.equal(lensTitle(evidenceFor(graph, runs, 'a.ts#outer')), 'observed 1× in 1 fresh run · no static callers');
  assert.equal(symbolAt(graph.symbols, 'a.ts', 4)?.id, 'a.ts#inner');
  assert.equal(canAllowlist(graph.symbols[1]), false);
});

test('document staleness compares sha256 of the text with the snapshot hash', () => {
  const snapshot = { files: [{ path: 'src/a.ts', hash: sha256Hex('x'), bytes: 1, language: 'typescript' as const }] };
  assert.equal(fileFreshness(snapshot, 'src/a.ts', 'x'), 'fresh');
  assert.equal(fileFreshness(snapshot, 'src/a.ts', 'y'), 'stale');
  assert.equal(fileFreshness(snapshot, 'src/b.ts', 'x'), 'unindexed');
  assert.equal(relativeFile('/r', '/r/src/a.ts'), 'src/a.ts');
  assert.equal(relativeFile('/r', '/elsewhere/a.ts'), null);
});

test('runs show a STALE badge; events form a call tree by parent', () => {
  assert.match(runDescription({ stale: true, createdAt: '2026-01-01T00:00:00.000Z' } as Run), /^STALE · 2026-01-01 00:00:00Z$/);
  const events = [{ seq: 0, parent: null }, { seq: 1, parent: 0 }, { seq: 2, parent: 1 }] as never[];
  assert.deepEqual(childEvents(events, 0), [events[1]]);
});

test('answers: unsupported sentences are flagged, unresolvable citations marked, abstain reads unknown', () => {
  const answer: Answer = {
    question: 'q<', abstained: false, text: '', unknowns: [], assumptions: [], model: 'm',
    sentences: [{ text: 'A [S:a.ts#outer].', citations: ['S:a.ts#outer'], supported: true }, { text: 'B [S:x#y].', citations: ['S:x#y'], supported: false }],
    citations: [{ kind: 'symbol', ref: 'a.ts#outer', valid: true, freshness: 'stale', span: span('a.ts', 1, 2), fileHash: 'h', label: 'outer' },
      { kind: 'symbol', ref: 'x#y', valid: false, freshness: 'missing', span: null, fileHash: null, label: '' }],
    usage: { model: 'm', inputTokens: 5, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null },
  };
  const html = answerBodyHtml(answer);
  assert.match(html, /<h2>q&lt;<\/h2>/);
  assert.match(html, /class="supported">A\. <a [^>]*class="cite stale"/);
  assert.match(html, /badge stale">stale/);
  assert.match(html, /class="unsupported"><span class="badge unsupported">unsupported<\/span> <s>B\.<\/s>.*\(unresolvable\)/);
  assert.match(html, /usage: model m · tokens in 5 out unknown · cache r\/w unknown\/unknown · cost unknown/);
  assert.equal(citationTarget(answer, 'S:a.ts#outer')?.freshness, 'stale');
  assert.equal(citationTarget(answer, 'S:x#y'), null);
  assert.deepEqual(parseCitationToken('E:run#3'), { kind: 'event', ref: 'run#3' });
  assert.match(answerBodyHtml({ ...answer, abstained: true, text: 'unknown: no evidence', sentences: [] }), /<strong>unknown<\/strong> — no evidence/);
  assert.equal(escapeHtml('<"&\'>'), '&lt;&quot;&amp;&#39;&gt;');
  assert.equal(answerUsageLine(null), 'usage: not reported');
});

test('usage: lower-bound cost, 5h tokens and plan utilization in the status bar; report has windows', () => {
  assert.equal(costText(totals()), 'model cost $0.5000');
  assert.equal(costText(totals({ unknownCost: 2 })), 'model cost ≥$0.5000 (2 calls with unknown cost)');
  const summary: UsageSummary = {
    since: '2026-11-10T00:00:00Z', totals: totals({ unknownCost: 1 }), groups: [{ ...totals(), kind: 'model', provider: 'claude-cli', model: 'opus' }],
    windows: { fiveHour: totals({ inputTokens: 7, outputTokens: 1 }), sevenDay: totals() },
    limits: [{ provider: 'claude-cli', window: 'five_hour', utilization: 0.42, resetsAt: '2026-11-10T20:00:00Z', status: 'allowed', reportedAt: '2026-11-10T15:00:00Z' },
      { provider: 'claude-cli', window: 'seven_day', utilization: null, resetsAt: null, status: null, reportedAt: '2026-11-10T15:00:00Z' }],
    recent: [{ id: 'u1', at: '2026-11-10T15:00:00Z', kind: 'model', projectId: null, provider: 'claude-cli', durationMs: 1500, ok: true, detail: 'ask',
      model: 'opus', inputTokens: 10, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null }],
  };
  assert.equal(usageStatusText(summary), '5h in 7 out 1 · plan 42%');
  const tip = usageTooltipLines(summary).join('\n');
  assert.match(tip, /^total model cost ≥\$0\.5000/);
  assert.match(tip, /plan five_hour \(claude-cli\): 42% used, resets 2026-11-10T20:00:00Z \[allowed\]/);
  assert.match(tip, /plan seven_day \(claude-cli\): unknown used/);
  const report = usageReport(summary);
  assert.match(report, /Last 5h: /);
  assert.match(report, /Last 7d: /);
  assert.match(report, /resets 2026-11-10T20:00:00Z/);
  assert.match(report, /- 2026-11-10T15:00:00Z model claude-cli \(opus\) ok · 1\.5s · in 10 out 2 · cost unknown · ask/);
  const view = statusView({ apiVersion: 1, indexer: 'i', sandbox: { name: 'docker', available: false, reason: 'no docker', runtime: null },
    model: { name: null, available: false, reason: 'no agent CLI found', model: null } }, null);
  assert.match(view.tooltip, /sandbox docker: unavailable — no docker/);
  assert.match(view.tooltip, /unavailable — no agent CLI found/);
  assert.match(statusView(null, null).text, /not connected/);
});
