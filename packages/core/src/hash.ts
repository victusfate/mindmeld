import { createHash, randomUUID } from 'node:crypto';

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** Snapshot identity: hash of the sorted path→hash manifest, so it is independent of read order. */
export function snapshotHashOf(fileHashes: Record<string, string>): string {
  const sorted = Object.keys(fileHashes).sort().map(path => [path, fileHashes[path]]);
  return sha256(JSON.stringify(sorted));
}

const ID_HEX_CHARS = 16;
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, ID_HEX_CHARS)}`;
