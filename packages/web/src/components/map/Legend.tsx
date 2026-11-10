// Map legend: the visual contract for static vs observed edges, plus the stale-run count.
export function Legend({ staleRuns, observed }: { staleRuns: number; observed: number }) {
  return (
    <aside className="legend" aria-label="Legend">
      <div><svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" className="legend-static" /></svg> static: possible call (parsed)</div>
      <div><svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" className="legend-observed" /></svg> observed: recorded in a run ({observed})</div>
      <div><span className="legend-node" aria-hidden="true" /> on replay path</div>
      {staleRuns > 0 && <div className="stale-note" data-testid="stale-runs"><span className="badge badge-stale">stale</span> {staleRuns} stale run{staleRuns === 1 ? '' : 's'} not drawn</div>}
    </aside>
  );
}
