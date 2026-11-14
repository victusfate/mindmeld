// Small collection helpers shared by the MCP tools and the explorer export.

/** Appends `value` to the list under `key`, creating it. */
export function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/** Occurrences of each value, most frequent first (ties keep first-seen order). */
export function countBy(values: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
