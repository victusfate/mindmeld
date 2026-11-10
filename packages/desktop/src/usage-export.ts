// Usage export: one JSON object per line, so the file can be appended to, grepped and shared back.
import type { UsageRecord } from '@mindmeld/core';

export const USAGE_EXPORT_NAME = 'mindmeld-usage.jsonl';

export function usageJsonl(records: readonly UsageRecord[]): string {
  return records.map(record => JSON.stringify(record) + '\n').join('');
}
