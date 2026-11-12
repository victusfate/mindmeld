import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsage, summarizeUsage, UNKNOWN_USAGE, type UsageRecord } from '../src/index.ts';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const HOUR = 3_600_000;
function rec(hoursAgo: number, over: Partial<UsageRecord> = {}): UsageRecord {
  return { ...UNKNOWN_USAGE, id: `u${hoursAgo}`, at: new Date(NOW - hoursAgo * HOUR).toISOString(), kind: 'model', projectId: null,
    provider: 'claude-cli', durationMs: 1000, ok: true, detail: '', inputTokens: 10, outputTokens: 5, costUsd: 0.01, ...over };
}

test('rolling 5h and 7d windows and all-time token totals', () => {
  const s = summarizeUsage([rec(200), rec(30), rec(4), rec(1, { costUsd: null })], NOW);
  assert.deepEqual([s.totals.count, s.totals.inputTokens, s.totals.outputTokens], [4, 40, 20]);
  assert.deepEqual([s.windows.fiveHour.count, s.windows.fiveHour.inputTokens, s.windows.fiveHour.outputTokens], [2, 20, 10]);
  assert.equal(s.windows.fiveHour.unknownCost, 1);
  assert.deepEqual([s.windows.sevenDay.count, s.windows.sevenDay.inputTokens], [3, 30]);
  const text = formatUsage(s);
  assert.match(text, /Tokens: in 40 · out 20/);
  assert.match(text, /Last 5h: 2 operations · tokens in 20 out 10 · cost ≥\$0\.0100/);
  assert.match(text, /Last 7d: 3 operations/);
});

test('latest provider plan windows win per provider+window', () => {
  const s = summarizeUsage([
    rec(3, { limits: [{ window: 'five_hour', utilization: 0.2, resetsAt: null, status: 'allowed' }] }),
    rec(1, { limits: [{ window: 'five_hour', utilization: 0.35, resetsAt: '2026-11-10T15:00:00.000Z', status: 'allowed' }, { window: 'seven_day', utilization: 0.48, resetsAt: null, status: 'allowed' }] }),
    rec(0.5, { limits: null }),
  ], NOW);
  assert.deepEqual(s.limits.map(l => [l.window, l.utilization]), [['five_hour', 0.35], ['seven_day', 0.48]]);
  assert.match(formatUsage(s), /Plan window five_hour \(claude-cli, reported .*\): 35% used, resets 2026-11-10T15:00:00.000Z \[allowed\]/);
});
