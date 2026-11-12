// Small display formatters shared by the panels.
const MS_PER_SECOND = 1000;
const HASH_CHARS = 10;
const PREVIEW_CHARS = 160;

export function duration(ms: number): string {
  if (ms < 1) return '<1 ms';
  return ms < MS_PER_SECOND ? `${Math.round(ms)} ms` : `${(ms / MS_PER_SECOND).toFixed(2)} s`;
}

export const shortHash = (hash: string): string => hash.replace(/^sha256:/, '').slice(0, HASH_CHARS);

export function preview(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

/** Pretty-print a serialized JSON value; leaves non-JSON text as it is. */
export function pretty(text: string | null): string {
  if (text === null) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
