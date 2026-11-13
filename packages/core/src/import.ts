// Safe repository import: read-only walk that never follows symlinks, never executes anything,
// bounds file count and bytes, and hashes every file it keeps.
import { lstatSync, readdirSync, readFileSync, realpathSync, type Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { sha256, snapshotHashOf } from './hash.ts';
import type { Language, SkippedFile, SourceFile } from './schema.ts';

export interface ImportLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxDepth: number }
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 150_000_000;
const MAX_DEPTH = 32;
export const DEFAULT_LIMITS: ImportLimits = { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, maxDepth: MAX_DEPTH };

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', 'target', 'vendor']);
const LANGUAGES: Record<string, Language> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.rs': 'rust', '.py': 'python', '.gd': 'gdscript',
  '.json': 'json', '.md': 'markdown', '.txt': 'text',
};
/** Data files are kept for citations and Q&A but never indexed, so they only get budget that code leaves over. */
const DATA_LANGUAGES = new Set<Language>(['json', 'markdown', 'text']);
const tierOf = (language: Language): number => (DATA_LANGUAGES.has(language) ? 1 : 0);

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

interface Candidate { full: string; rel: string; size: number; language: Language }
interface WalkState {
  root: string; limits: ImportLimits; ignored: (n: string) => boolean; inScope: (rel: string, isDir: boolean) => boolean;
  out: ImportedRepo; candidates: Candidate[];
}

/** An empty scope admits everything; otherwise a directory is walked only on the way to, or inside, a scope entry. */
function scopeMatcher(include: readonly string[]): (rel: string, isDir: boolean) => boolean {
  if (!include.length) return () => true;
  return (rel, isDir) => include.some(dir => rel.startsWith(`${dir}/`) || (isDir && (rel === dir || dir.startsWith(`${rel}/`))));
}

function visitFile(state: WalkState, full: string, rel: string): void {
  const language = LANGUAGES[extname(rel).toLowerCase()];
  if (language) state.candidates.push({ full, rel, size: lstatSync(full).size, language });
}

function visitEntry(state: WalkState, entry: Dirent, depth: number): void {
  const full = join(entry.parentPath, entry.name);
  const rel = relative(state.root, full).split(sep).join('/');
  if (entry.isSymbolicLink()) { state.out.skipped.push({ path: rel, reason: 'symlink not followed' }); return; }
  if (entry.name.startsWith('.') || state.ignored(entry.name)) return;
  if (!isSafeRelativePath(rel)) { state.out.skipped.push({ path: rel, reason: 'unsafe path' }); return; }
  if (!state.inScope(rel, entry.isDirectory())) return;
  if (entry.isDirectory()) { if (!IGNORED_DIRS.has(entry.name)) walk(state, full, depth + 1); }
  else if (entry.isFile()) visitFile(state, full, rel);
}

function walk(state: WalkState, dir: string, depth: number): void {
  if (depth > state.limits.maxDepth) { state.out.skipped.push({ path: relative(state.root, dir), reason: 'too deep' }); return; }
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) visitEntry(state, entry, depth);
}

/** Admits candidates code-first, then path order, until the file or byte budget is spent; reads only what it admits. */
function admit(state: WalkState): void {
  const { limits, out } = state;
  const ordered = [...state.candidates].sort((a, b) => tierOf(a.language) - tierOf(b.language) || (a.rel < b.rel ? -1 : 1));
  let total = 0;
  for (const { full, rel, size, language } of ordered) {
    if (size > limits.maxFileBytes) { out.skipped.push({ path: rel, reason: 'file too large' }); continue; }
    if (out.files.length >= limits.maxFiles) { out.skipped.push({ path: rel, reason: 'file limit reached' }); continue; }
    if (total + size > limits.maxTotalBytes) { out.skipped.push({ path: rel, reason: 'total byte limit reached' }); continue; }
    const bytes = readFileSync(full);
    if (bytes.includes(0)) { out.skipped.push({ path: rel, reason: 'binary content' }); continue; }
    total += bytes.length;
    out.files.push({ path: rel, hash: sha256(bytes), bytes: bytes.length, language });
    out.contents.set(rel, bytes.toString('utf8'));
  }
}

/** `include` is the project's import scope: repo-relative directories, already validated with `isSafeRelativePath`. */
export function importRepository(rootPath: string, limits: ImportLimits = DEFAULT_LIMITS, include: readonly string[] = []): ImportedRepo {
  const root = realpathSync(rootPath);
  if (!lstatSync(root).isDirectory()) throw new Error('repository root must be a directory');
  const out: ImportedRepo = { files: [], contents: new Map(), skipped: [], snapshotHash: '' };
  const state: WalkState = { root, limits, ignored: gitignoreMatcher(root), inScope: scopeMatcher(include), out, candidates: [] };
  walk(state, root, 0);
  admit(state);
  out.snapshotHash = snapshotHashOf(Object.fromEntries(out.files.map(f => [f.path, f.hash])));
  return out;
}
