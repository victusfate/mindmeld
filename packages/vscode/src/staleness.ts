// Compares an open document with the indexed snapshot. The server hashes raw file bytes with sha256, so the
// document text is hashed as UTF-8; a mismatch means the lenses describe an older version of the file.
import { createHash } from 'node:crypto';
import { posix, relative, sep } from 'node:path';
import type { RepoSnapshot } from '@mindmeld/client';

export type FileFreshness = 'fresh' | 'stale' | 'unindexed';

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export function fileFreshness(snapshot: Pick<RepoSnapshot, 'files'>, file: string, text: string): FileFreshness {
  const indexed = snapshot.files.find(f => f.path === file);
  if (!indexed) return 'unindexed';
  return indexed.hash === sha256Hex(text) ? 'fresh' : 'stale';
}

/** Workspace-relative POSIX path (the form snapshot paths use), or null when the file is outside the root. */
export function relativeFile(root: string, fsPath: string): string | null {
  const rel = relative(root, fsPath);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep) || /^[a-zA-Z]:/.test(rel)) return null;
  return rel.split(sep).join(posix.sep);
}
