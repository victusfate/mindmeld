// Usage formatting. Null means the provider did not report a value: it renders as "unknown", never as 0.
import type { Answer, UsageSummary } from '@mindmeld/client';

export type UsageTotals = UsageSummary['totals'];

export type ModelUsage = NonNullable<Answer['usage']>;
export const UNKNOWN = 'unknown';
const COST_DECIMALS = 4;
const MS_PER_SECOND = 1000;

export const count = (n: number | null | undefined): string => (n === null || n === undefined ? UNKNOWN : n.toLocaleString('en-US'));
export const money = (n: number | null | undefined): string => (n === null || n === undefined ? UNKNOWN : `$${n.toFixed(COST_DECIMALS)}`);
export const seconds = (ms: number): string => `${(ms / MS_PER_SECOND).toFixed(1)} s`;

/** Total model cost; a lower bound ("≥") when some model calls did not report cost. */
export function costLabel(t: UsageTotals): string {
  return `${t.unknownCost > 0 ? '≥' : ''}${money(t.costUsd)}`;
}

/** One line for an answer: model, tokens in/out, cache read/write and cost. */
export function usageLine(u: ModelUsage | null): string {
  if (!u) return 'usage unknown';
  return [
    `model ${u.model ?? UNKNOWN}`,
    `${count(u.inputTokens)} in / ${count(u.outputTokens)} out`,
    `cache ${count(u.cacheReadTokens)} read / ${count(u.cacheWriteTokens)} write`,
    `cost ${money(u.costUsd)}`,
  ].join(' · ');
}

export type Limit = UsageSummary['limits'][number];
const PERCENT = 100;
const WINDOW_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly' };

export const windowName = (w: string): string => WINDOW_NAMES[w] ?? w.replace(/_/g, ' ');
/** Utilization 0..1 → whole percent (clamped), or null when the provider did not report it. */
export const percent = (u: number | null): number | null => (u === null ? null : Math.round(Math.min(Math.max(u, 0), 1) * PERCENT));

export function limitLabel(l: Limit): string {
  const p = percent(l.utilization);
  const used = p === null ? `${UNKNOWN} used` : `${p}% used`;
  return `${l.provider} ${windowName(l.window)} plan: ${used}${l.resetsAt ? `, resets ${new Date(l.resetsAt).toLocaleString()}` : ''}${l.status ? ` (${l.status})` : ''}`;
}

const windowSummary = (label: string, t: UsageTotals): string =>
  `${label}: ${t.count} ops · ${count(t.inputTokens)} in / ${count(t.outputTokens)} out · ${costLabel(t)}`;

/** Multi-line tooltip for the header usage chip: totals, rolling 5h/7d windows and provider plan windows. */
export function usageTooltip(s: UsageSummary): string {
  return [
    `Total model cost ${costLabel(s.totals)} (≥ when some calls did not report cost)`,
    `Tokens: ${count(s.totals.inputTokens)} in / ${count(s.totals.outputTokens)} out`,
    windowSummary('Last 5 hours', s.windows.fiveHour),
    windowSummary('Last 7 days', s.windows.sevenDay),
    ...s.limits.map(limitLabel),
  ].join('\n');
}
