// Validation for user-typed run inputs and status-bar wording. Kept free of `vscode` so it is unit-testable.
import type { Status, UsageSummary } from '@mindmeld/client';
import { usageStatusText, usageTooltipLines } from './usage.ts';

export type ParsedArgs = { ok: true; value: unknown[] } | { ok: false; error: string };

export function parseArgsJson(text: string): ParsedArgs {
  let value: unknown;
  try { value = JSON.parse(text.trim() || '[]'); } catch (e) { return { ok: false, error: `not valid JSON: ${(e as Error).message}` }; }
  if (!Array.isArray(value)) return { ok: false, error: 'arguments must be a JSON array, e.g. [1, "two"]' };
  return { ok: true, value };
}

/** InputBox validateInput contract: a message when invalid, null when valid. */
export const argsValidationMessage = (text: string): string | null => {
  const parsed = parseArgsJson(text);
  return parsed.ok ? null : parsed.error;
};

export interface StatusView { text: string; tooltip: string }

const icon = (available: boolean): string => (available ? '$(check)' : '$(circle-slash)');
const availability = (available: boolean): string => (available ? 'available' : 'unavailable');

export function statusView(status: Status | null, usage: UsageSummary | null, error?: string): StatusView {
  if (!status) return { text: '$(debug-disconnect) Mind Meld: not connected', tooltip: error ?? 'Run "Mind Meld: Connect"' };
  return {
    text: `$(plug) Mind Meld · ${icon(status.sandbox.available)} sandbox · ${icon(status.model.available)} model${usage ? ` · ${usageStatusText(usage)}` : ''}`,
    tooltip: [
      `sandbox ${status.sandbox.name}: ${availability(status.sandbox.available)} — ${status.sandbox.reason}`,
      `model ${status.model.model ?? status.model.name ?? '(none)'}: ${availability(status.model.available)} — ${status.model.reason}`,
      ...(usage ? usageTooltipLines(usage) : ['model cost: unknown (usage not loaded)']),
    ].join('\n'),
  };
}
