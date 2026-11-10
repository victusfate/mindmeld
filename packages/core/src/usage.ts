// Usage telemetry: one append-only record per model call, sandbox run and index. Values a provider did not
// report are null — unknown, never zero (the scaffold's delivery-rigor rule). Records are shared back through
// answers, the API summary, a JSONL export and `mindmeld-studio --usage`.
export type UsageKind = 'model' | 'run' | 'index';

/** What a model connector could measure about one call. */
export interface ModelUsage {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
}
/** A plan/rate-limit window as the provider CLI reports it (e.g. claude's five_hour / seven_day). */
export interface ProviderLimit { window: string; utilization: number | null; resetsAt: string | null; status: string | null }
export const UNKNOWN_USAGE: ModelUsage = { model: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null };

export interface UsageRecord extends ModelUsage {
  id: string;
  at: string;
  kind: UsageKind;
  projectId: string | null;
  /** Model connector (e.g. claude-cli) or sandbox connector (e.g. docker-oci) or indexer version. */
  provider: string;
  durationMs: number;
  ok: boolean;
  detail: string;
  /** Provider-reported limit windows at the time of this call; null when the CLI does not report them. */
  limits?: ProviderLimit[] | null;
}

export interface UsageTotals {
  count: number;
  failed: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Records whose provider did not report cost: totals are lower bounds when this is > 0. */
  unknownCost: number;
}
export interface UsageGroup extends UsageTotals { kind: UsageKind; provider: string; model: string | null }
export interface LatestLimit extends ProviderLimit { provider: string; reportedAt: string }
export interface UsageSummary {
  since: string | null;
  totals: UsageTotals;
  /** Rolling windows computed from Studio's own records (all kinds; tokens/cost come from model calls). */
  windows: { fiveHour: UsageTotals; sevenDay: UsageTotals };
  /** Latest provider-reported plan windows (utilization 0..1), one per provider+window. */
  limits: LatestLimit[];
  groups: UsageGroup[];
  recent: UsageRecord[];
}

const RECENT = 20;
const HOUR_MS = 3_600_000;
const FIVE_HOURS_MS = 5 * HOUR_MS;
const SEVEN_DAYS_MS = 168 * HOUR_MS;
const PERCENT = 100;
const MS_PER_SECOND = 1000;
const COST_DECIMALS = 4;
const add = (a: number, b: number | null): number => a + (b ?? 0);

function empty(): UsageTotals {
  return { count: 0, failed: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unknownCost: 0 };
}

function accumulate(t: UsageTotals, r: UsageRecord): void {
  t.count++;
  if (!r.ok) t.failed++;
  t.durationMs += r.durationMs;
  t.inputTokens = add(t.inputTokens, r.inputTokens);
  t.outputTokens = add(t.outputTokens, r.outputTokens);
  t.cacheReadTokens = add(t.cacheReadTokens, r.cacheReadTokens);
  t.cacheWriteTokens = add(t.cacheWriteTokens, r.cacheWriteTokens);
  t.costUsd = add(t.costUsd, r.costUsd);
  if (r.kind === 'model' && r.costUsd === null) t.unknownCost++;
}

function windowTotals(records: UsageRecord[], now: number, spanMs: number): UsageTotals {
  const t = empty();
  for (const r of records) if (now - Date.parse(r.at) <= spanMs) accumulate(t, r);
  return t;
}

function latestLimits(records: UsageRecord[]): LatestLimit[] {
  const latest = new Map<string, LatestLimit>();
  for (const r of records) for (const l of r.limits ?? []) latest.set(`${r.provider}|${l.window}`, { ...l, provider: r.provider, reportedAt: r.at });
  return [...latest.values()];
}

export function summarizeUsage(records: UsageRecord[], now = Date.now()): UsageSummary {
  const totals = empty();
  const groups = new Map<string, UsageGroup>();
  for (const r of records) {
    accumulate(totals, r);
    const key = `${r.kind}|${r.provider}|${r.model ?? ''}`;
    const g = groups.get(key) ?? { ...empty(), kind: r.kind, provider: r.provider, model: r.model };
    accumulate(g, r);
    groups.set(key, g);
  }
  return {
    since: records[0]?.at ?? null, totals, groups: [...groups.values()], recent: records.slice(-RECENT).reverse(),
    windows: { fiveHour: windowTotals(records, now, FIVE_HOURS_MS), sevenDay: windowTotals(records, now, SEVEN_DAYS_MS) },
    limits: latestLimits(records),
  };
}

const money = (n: number): string => `$${n.toFixed(COST_DECIMALS)}`;
const costText = (t: UsageTotals): string => `${t.unknownCost ? '≥' : ''}${money(t.costUsd)}`;
const windowLine = (label: string, w: UsageTotals): string =>
  `${label}: ${w.count} operations · tokens in ${w.inputTokens} out ${w.outputTokens} · cost ${costText(w)}`;
function limitLine(l: LatestLimit): string {
  const used = l.utilization === null ? 'unknown' : `${Math.round(l.utilization * PERCENT)}% used`;
  return `Plan window ${l.window} (${l.provider}, reported ${l.reportedAt}): ${used}${l.resetsAt ? `, resets ${l.resetsAt}` : ''}${l.status ? ` [${l.status}]` : ''}`;
}

/** Plain-text report for terminals and for pasting into an issue or chat. */
export function formatUsage(s: UsageSummary): string {
  if (!s.totals.count) return 'Mind Meld usage: no activity recorded yet.';
  const t = s.totals;
  const lines = [`Mind Meld usage since ${s.since ?? 'start'}: ${t.count} operations, ${t.failed} failed`,
    `Tokens: in ${t.inputTokens} · out ${t.outputTokens} · cache read ${t.cacheReadTokens} · cache write ${t.cacheWriteTokens} · cost ${costText(t)}`,
    windowLine('Last 5h', s.windows.fiveHour), windowLine('Last 7d', s.windows.sevenDay)];
  for (const l of s.limits) lines.push(limitLine(l));
  for (const g of s.groups) {
    const tokens = g.kind === 'model' ? ` · tokens in ${g.inputTokens} out ${g.outputTokens} cache r/w ${g.cacheReadTokens}/${g.cacheWriteTokens}` : '';
    const cost = g.kind === 'model' ? ` · cost ${money(g.costUsd)}${g.unknownCost ? ` (+${g.unknownCost} calls with unknown cost)` : ''}` : '';
    lines.push(`- ${g.kind} ${g.provider}${g.model ? ` (${g.model})` : ''}: ${g.count}× · ${(g.durationMs / MS_PER_SECOND).toFixed(1)}s${tokens}${cost}`);
  }
  return lines.join('\n');
}
