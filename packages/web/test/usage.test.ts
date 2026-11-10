import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageSummary } from '@mindmeld/client';
import { costLabel, count, limitLabel, money, percent, usageLine, usageTooltip, windowName } from '../src/lib/usage.ts';

const totals = (o: Partial<UsageSummary['totals']> = {}): UsageSummary['totals'] => ({
  count: 2, failed: 0, durationMs: 1500, inputTokens: 1200, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.0123, unknownCost: 0, ...o,
});

test('null usage values render as unknown, never 0', () => {
  assert.equal(count(null), 'unknown');
  assert.equal(money(null), 'unknown');
  assert.equal(count(0), '0');
  assert.equal(money(0), '$0.0000');
  assert.equal(usageLine(null), 'usage unknown');
  assert.equal(usageLine({ model: 'm', inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: 5, costUsd: null }),
    'model m · 100 in / 20 out · cache unknown read / 5 write · cost unknown');
});

test('cost is a lower bound when some model calls did not report cost', () => {
  assert.equal(costLabel(totals()), '$0.0123');
  assert.equal(costLabel(totals({ unknownCost: 1 })), '≥$0.0123');
});

test('plan-window utilization is a clamped percent and unknown stays unknown', () => {
  assert.equal(percent(0.456), 46);
  assert.equal(percent(1.4), 100);
  assert.equal(percent(null), null);
  assert.equal(windowName('five_hour'), '5-hour');
  assert.equal(windowName('seven_day'), 'weekly');
  assert.match(limitLabel({ provider: 'claude-cli', window: 'seven_day', utilization: null, resetsAt: null, status: null, reportedAt: '2026-11-10T00:00:00Z' }), /weekly plan: unknown used$/);
});

test('usage chip tooltip lists totals, rolling windows and plan windows', () => {
  const s: UsageSummary = {
    since: null, totals: totals({ unknownCost: 1 }), groups: [], recent: [],
    windows: { fiveHour: totals({ count: 1 }), sevenDay: totals() },
    limits: [{ provider: 'claude-cli', window: 'five_hour', utilization: 0.25, resetsAt: '2026-11-10T20:00:00Z', status: 'allowed', reportedAt: '2026-11-10T15:00:00Z' }],
  };
  const tip = usageTooltip(s).split('\n');
  assert.match(tip[0], /≥\$0\.0123/);
  assert.equal(tip[1], 'Tokens: 1,200 in / 30 out');
  assert.match(tip[2], /^Last 5 hours: 1 ops/);
  assert.match(tip[3], /^Last 7 days: 2 ops/);
  assert.match(tip[4], /claude-cli 5-hour plan: 25% used, resets .* \(allowed\)/);
});
