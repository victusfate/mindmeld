// Replay: step through a recorded run's events (buttons, slider, arrow keys) with the call stack, args,
// result or thrown value and the receiver before/after. The App highlights the walked path on the map.
import type { RunResult, TraceEvent } from '@mindmeld/client';
import type { ProjectData } from '../../hooks.ts';
import { callStack, clampStep } from '../../lib/replay.ts';
import { shortSymbol } from '../../lib/diff.ts';
import { duration, pretty } from '../../lib/format.ts';
import { RunBadges } from './RunPanel.tsx';

interface Props { data: ProjectData; result: RunResult | null; step: number; onReplay: (runId: string, step: number) => void; onSelect: (id: string) => void }

function Value({ label, text }: { label: string; text: string | null }) {
  if (text === null) return null;
  return <><dt>{label}</dt><dd><pre className="mono">{pretty(text)}</pre></dd></>;
}

function EventDetail({ event, onSelect }: { event: TraceEvent; onSelect: (id: string) => void }) {
  return (
    <dl className="event" data-testid="event">
      <dt>Call</dt>
      <dd><button type="button" className="link mono" onClick={() => onSelect(event.symbol)}>{event.symbol}</button>
        <span className="muted small"> depth {event.depth} · {duration(event.durationMs)}{event.async ? ' · async' : ''}</span></dd>
      <Value label="Args" text={event.args} />
      <Value label={event.threw ? 'Threw' : 'Result'} text={event.result} />
      <Value label="Receiver before" text={event.thisBefore} />
      <Value label="Receiver after" text={event.thisAfter} />
    </dl>
  );
}

function RunPicker({ data, runId, onReplay }: { data: ProjectData; runId: string; onReplay: Props['onReplay'] }) {
  return (
    <label>Run
      <select value={runId} onChange={e => onReplay(e.target.value, 0)}>
        {!runId && <option value="">choose a run</option>}
        {[...data.runs].reverse().map(r => <option key={r.id} value={r.id}>{shortSymbol(r.entrySymbol)} {r.status}{r.stale ? ' (stale)' : ''} · {r.id}</option>)}
      </select>
    </label>
  );
}

export function ReplayPanel({ data, result, step, onReplay, onSelect }: Props) {
  if (!result) return (<div><h2>Replay</h2>{data.runs.length ? <RunPicker data={data} runId="" onReplay={onReplay} /> : <p className="muted">Record a run first.</p>}</div>);
  const { run, events } = result;
  const at = clampStep(step, events.length);
  const go = (n: number): void => onReplay(run.id, clampStep(n, events.length));
  const event = events[at];
  return (
    <div className="replay">
      <div className="panel-head"><h2>Replay</h2><RunPicker data={data} runId={run.id} onReplay={onReplay} /></div>
      <p className="meta"><RunBadges run={run} /> <span className="mono">{run.sandbox.connector}</span> <span className="muted small">{duration(run.durationMs)}</span></p>
      {run.stale && <p className="warn small">Stale: {(run.staleFiles ?? []).join(', ')} changed since this run. It adds no observed edges.</p>}
      <p className="small">Output: <code className="mono">{run.error ?? run.output}</code></p>
      {events.length === 0 ? <p className="muted">This run recorded no events.</p> : (
        <>
          <div className="stepper">
            <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous event">◀</button>
            <input type="range" min={0} max={events.length - 1} value={at} onChange={e => go(Number(e.target.value))} aria-label="Event" data-testid="replay-slider" />
            <button type="button" onClick={() => go(at + 1)} disabled={at === events.length - 1} aria-label="Next event" data-testid="replay-next">▶</button>
            <span className="mono small" data-testid="replay-step">{at + 1} / {events.length}</span>
          </div>
          <h3>Call stack</h3>
          <ol className="stack">{callStack(events, at).map(e => <li key={e.seq} className="mono">{shortSymbol(e.symbol)}</li>)}</ol>
          {event && <EventDetail event={event} onSelect={onSelect} />}
        </>
      )}
    </div>
  );
}
