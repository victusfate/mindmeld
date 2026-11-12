// Safe repository import: read-only walk that never follows symlinks, never executes anything,
// bounds file count and bytes, and hashes every file it keeps.
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { sha256, snapshotHashOf } from './hash.ts';
import type { Language, SkippedFile, SourceFile } from './schema.ts';

export interface ImportLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxDepth: number }
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const MAX_DEPTH = 32;
export const DEFAULT_LIMITS: ImportLimits = { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, maxDepth: MAX_DEPTH };

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', 'target', 'vendor']);
const LANGUAGES: Record<string, Language> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.md': 'markdown', '.txt': 'text',
};

export interface ImportedRepo {
  files: SourceFile[];
  contents: Map<string, string>;
  skipped: SkippedFile[];
  snapshotHash: string;
}

/** Minimal .gitignore support: plain names and `dir/` entries at any depth; `*.ext` suffix globs. */
function gitignoreMatcher(root: string): (name: string) => boolean {
  let lines: string[] = [];
  try { lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n'); } catch { /* none */ }
  const names = new Set<string>();
  const suffixes: string[] = [];
  for (const raw of lines) {
    const line = raw.trim().replace(/^\//, '').replace(/\/$/, '');
    if (!line || line.startsWith('#') || line.startsWith('!') || line.includes('/')) continue;
    if (/^\*\.[\w.]+$/.test(line)) suffixes.push(line.slice(1));
    else if (!/[*?[]/.test(line)) names.add(line);
  }
  return name => names.has(name) || suffixes.some(s => name.endsWith(s));
}

export function isSafeRelativePath(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

interface WalkState { root: string; limits: ImportLimits; ignored: (n: string) => boolean; out: ImportedRepo; total: number }

function visitFile(state: WalkState, full: string, rel: string): void {
  const language = LANGUAGES[extname(rel).toLowerCase()];
  if (!language) return;
  const stat = lstatSync(full);
  if (stat.size > state.limits.maxFileBytes) { state.out.skipped.push({ path: rel, reason: 'file too large' }); return; }
  if (state.out.files.length >= state.limits.maxFiles) { state.out.skipped.push({ path: rel, reason: 'file limit reached' }); return; }
  if (state.total + stat.size > state.limits.maxTotalBytes) { state.out.skipped.push({ path: rel, reason: 'total byte limit reached' }); return; }
  const bytes = readFileSync(full);
  if (bytes.includes(0)) { state.out.skipped.push({ path: rel, reason: 'binary content' }); return; }
  state.total += bytes.length;
  const content = bytes.toString('utf8');
  state.out.files.push({ path: rel, hash: sha256(bytes), bytes: bytes.length, language });
  state.out.contents.set(rel, content);
}

function walk(state: WalkState, dir: string, depth: number): void {
  if (depth > state.limits.maxDepth) { state.out.skipped.push({ path: relative(state.root, dir), reason: 'too deep' }); return; }
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(state.root, full).split(sep).join('/');
    if (entry.isSymbolicLink()) { state.out.skipped.push({ path: rel, reason: 'symlink not followed' }); continue; }
    if (entry.name.startsWith('.') || state.ignored(entry.name)) continue;
    if (!isSafeRelativePath(rel)) { state.out.skipped.push({ path: rel, reason: 'unsafe path' }); continue; }
    if (entry.isDirectory()) { if (!IGNORED_DIRS.has(entry.name)) walk(state, full, depth + 1); }
    else if (entry.isFile()) visitFile(state, full, rel);
  }
}

export function importRepository(rootPath: string, limits: ImportLimits = DEFAULT_LIMITS): ImportedRepo {
  const root = realpathSync(rootPath);
  if (!lstatSync(root).isDirectory()) throw new Error('repository root must be a directory');
  const out: ImportedRepo = { files: [], contents: new Map(), skipped: [], snapshotHash: '' };
  walk({ root, limits, ignored: gitignoreMatcher(root), out, total: 0 }, root, 0);
  out.snapshotHash = snapshotHashOf(Object.fromEntries(out.files.map(f => [f.path, f.hash])));
  return out;
}
