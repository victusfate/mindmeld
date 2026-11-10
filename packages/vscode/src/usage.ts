// Usage wording for answers, the status bar and the shareable report. Unknown values (null) read "unknown",
// never zero, and a total that misses some costs is a lower bound ("≥").
import type { UsageRecord, UsageSummary } from '@mindmeld/client';
import { formatUsage, type LatestLimit, type ModelUsage, type UsageTotals } from '@mindmeld/core/usage';

const COST_DECIMALS = 4;
const PERCENT = 100;
const MS_PER_SECOND = 1000;
const money = (n: number): string => `$${n.toFixed(COST_DECIMALS)}`;
const known = (n: number | null, render: (v: number) => string = String): string => (n === null ? 'unknown' : render(n));

/** One line per answer: which model, tokens and cost as the CLI reported them. */
export function answerUsageLine(usage: ModelUsage | null): string {
  if (!usage) return 'usage: not reported';
  return [
    `usage: model ${usage.model ?? 'unknown'}`,
    `tokens in ${known(usage.inputTokens)} out ${known(usage.outputTokens)}`,
    `cache r/w ${known(usage.cacheReadTokens)}/${known(usage.cacheWriteTokens)}`,
    `cost ${known(usage.costUsd, money)}`,
  ].join(' · ');
}

/** Total model cost for the status-bar tooltip; prefixed "≥" when some calls did not report cost. */
export function costText(totals: UsageTotals): string {
  const prefix = totals.unknownCost > 0 ? '≥' : '';
  const note = totals.unknownCost > 0 ? ` (${totals.unknownCost} calls with unknown cost)` : '';
  return `model cost ${prefix}${money(totals.costUsd)}${note}`;
}

const percent = (l: LatestLimit): string => (l.utilization === null ? 'unknown' : `${Math.round(l.utilization * PERCENT)}%`);

/** The most-used five-hour plan window across providers, if any CLI reported one. */
function fiveHourLimit(limits: LatestLimit[]): LatestLimit | undefined {
  return limits.filter(l => l.window === 'five_hour').sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
}

/** Short status-bar text: 5-hour tokens in/out, plus plan utilization when a CLI reported it. */
export function usageStatusText(summary: UsageSummary): string {
  const w = summary.windows.fiveHour;
  const limit = fiveHourLimit(summary.limits);
  return `5h in ${w.inputTokens} out ${w.outputTokens}${limit ? ` · plan ${percent(limit)}` : ''}`;
}

const windowLine = (label: string, w: UsageTotals): string =>
  `${label}: ${w.count} ops · tokens in ${w.inputTokens} out ${w.outputTokens} · ${costText(w)}`;

/** Status-bar tooltip lines: total cost and tokens, both rolling windows, and plan windows with reset times. */
export function usageTooltipLines(summary: UsageSummary): string[] {
  const t = summary.totals;
  return [
    `total ${costText(t)} · tokens in ${t.inputTokens} out ${t.outputTokens}`,
    windowLine('last 5h', summary.windows.fiveHour),
    windowLine('last 7d', summary.windows.sevenDay),
    ...summary.limits.map(l => `plan ${l.window} (${l.provider}): ${percent(l)} used${l.resetsAt ? `, resets ${l.resetsAt}` : ''}${l.status ? ` [${l.status}]` : ''}`),
  ];
}

function recordLine(r: UsageRecord): string {
  const tokens = r.kind === 'model' ? ` · in ${known(r.inputTokens)} out ${known(r.outputTokens)} · cost ${known(r.costUsd, money)}` : '';
  const model = r.model ? ` (${r.model})` : '';
  return `- ${r.at} ${r.kind} ${r.provider}${model} ${r.ok ? 'ok' : 'FAILED'} · ${(r.durationMs / MS_PER_SECOND).toFixed(1)}s${tokens}${r.detail ? ` · ${r.detail}` : ''}`;
}

/** Plain-text report to copy into an issue or chat: totals and groups (core's format) plus recent records. */
export function usageReport(summary: UsageSummary): string {
  const lines = [formatUsage(summary)];
  if (summary.recent.length) lines.push('', 'Recent:', ...summary.recent.map(recordLine));
  return lines.join('\n');
}
