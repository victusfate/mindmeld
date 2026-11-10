// Availability banner and transient error notice. When the sandbox or model is unavailable the map, source
// and replay keep working; only Run / Ask are disabled, and the banner says why.
import type { Status } from '@mindmeld/client';

export function Banner({ status }: { status: Status | null }) {
  if (!status) return null;
  const problems: string[] = [];
  if (!status.sandbox.available) problems.push(`Sandbox unavailable (${status.sandbox.reason}): Run is disabled.`);
  if (!status.model.available) problems.push(`Model unavailable (${status.model.reason}): Ask is disabled.`);
  if (!problems.length) return null;
  return (
    <div className="banner" role="status" data-testid="banner">
      {problems.map(p => <p key={p}>{p}</p>)}
      <p className="muted">The map, source and replay still work.</p>
    </div>
  );
}

export function Notice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div className="notice" role="alert">
      <span>{message}</span>
      <button type="button" className="ghost" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
