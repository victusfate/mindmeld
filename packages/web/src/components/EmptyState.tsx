// Shown in the map pane before any project exists or while the graph loads.
export function EmptyState({ hasProjects }: { hasProjects: boolean }) {
  return (
    <div className="empty">
      <h2>{hasProjects ? 'Loading map…' : 'Import a repository'}</h2>
      {!hasProjects && <p>Use <strong>Import</strong> in the header with a local path or an https git URL. Studio indexes the source; it never runs it outside the sandbox.</p>}
    </div>
  );
}
