// Usage: totals, per-provider groups and recent records, with a JSONL export to share usage back.
import type { UsageSummary } from '@mindmeld/client';
import { duration } from '../../lib/format.ts';
import { costLabel, count, limitLabel, money, percent, seconds, windowName, type Limit, type UsageTotals } from '../../lib/usage.ts';

const HIGH_USE = 80;

function Totals({ t }: { t: UsageTotals }) {
  return (
    <dl className="totals" data-testid="usage-totals">
      <dt>Model cost</dt><dd data-testid="usage-cost">{costLabel(t)}</dd>
      <dt>Records</dt><dd>{t.count} ({t.failed} failed)</dd>
      <dt>Time</dt><dd>{seconds(t.durationMs)}</dd>
      <dt>Tokens in / out</dt><dd>{count(t.inputTokens)} / {count(t.outputTokens)}</dd>
      <dt>Cache read / write</dt><dd>{count(t.cacheReadTokens)} / {count(t.cacheWriteTokens)}</dd>
      {t.unknownCost > 0 && <><dt>Unreported cost</dt><dd>{t.unknownCost} model call(s); totals are lower bounds</dd></>}
    </dl>
  );
}

function Windows({ w }: { w: UsageSummary['windows'] }) {
  const rows: [string, UsageTotals][] = [['Last 5 hours', w.fiveHour], ['Last 7 days', w.sevenDay]];
  return (
    <table className="grid" data-testid="usage-windows">
      <thead><tr><th scope="col">Window</th><th scope="col">Ops</th><th scope="col">Tokens in / out</th><th scope="col">Cost</th></tr></thead>
      <tbody>{rows.map(([label, t]) => (
        <tr key={label}><td>{label}</td><td>{t.count}</td><td>{count(t.inputTokens)} / {count(t.outputTokens)}</td><td>{costLabel(t)}</td></tr>
      ))}</tbody>
    </table>
  );
}

function LimitBar({ limit }: { limit: Limit }) {
  const p = percent(limit.utilization);
  return (
    <li className="limit" data-testid="usage-limit">
      <span className="small">{limitLabel(limit)}</span>
      <span className="bar" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={limit.utilization ?? undefined} aria-label={`${windowName(limit.window)} plan utilization`}>
        {p !== null && <span className={`bar-fill${p >= HIGH_USE ? ' high' : ''}`} style={{ width: `${p}%` }} />}
      </span>
    </li>
  );
}

export function UsagePanel({ usage }: { usage: UsageSummary | null }) {
  if (!usage) return <p className="muted">Loading usage…</p>;
  return (
    <div className="usage">
      <div className="panel-head"><h2>Usage</h2><a className="button" href="/api/usage/export" download>Export JSONL</a></div>
      <p className="muted small">{usage.since ? `Since ${new Date(usage.since).toLocaleString()}` : 'Nothing recorded yet.'}</p>
      <Totals t={usage.totals} />
      <h3>Rolling windows</h3>
      <Windows w={usage.windows} />
      <h3>Provider plan windows</h3>
      {usage.limits.length ? <ul className="limits">{usage.limits.map(l => <LimitBar key={`${l.provider}|${l.window}`} limit={l} />)}</ul>
        : <p className="muted small">No provider has reported plan windows (only the claude CLI reports them).</p>}
      <h3>By provider</h3>
      <table className="grid">
        <thead><tr><th scope="col">Kind</th><th scope="col">Provider / model</th><th scope="col">Count</th><th scope="col">Tokens in/out</th><th scope="col">Cost</th></tr></thead>
        <tbody>{usage.groups.map(g => (
          <tr key={`${g.kind}|${g.provider}|${g.model ?? ''}`}>
            <td>{g.kind}</td><td className="mono">{g.provider}{g.model ? ` / ${g.model}` : ''}</td><td>{g.count}</td>
            <td>{count(g.inputTokens)} / {count(g.outputTokens)}</td><td>{g.kind === 'model' ? costLabel(g) : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      <h3>Recent</h3>
      <ul className="recent">{usage.recent.map(r => (
        <li key={r.id}>
          <span className={`badge badge-${r.ok ? 'ok' : 'error'}`}>{r.kind}</span> <span className="mono small">{r.provider}</span>
          <span className="muted small"> {duration(r.durationMs)}{r.kind === 'model' ? ` · ${money(r.costUsd)}` : ''} · {r.detail}</span>
        </li>
      ))}</ul>
    </div>
  );
}
