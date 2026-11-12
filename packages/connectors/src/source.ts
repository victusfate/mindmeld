// Repository source connectors. They only place files on disk for read-only import: no hooks, no
// submodules, no install scripts, no credentials, and git transports limited to https.
import { execAsync } from './exec.ts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type { SourceConnector } from '@mindmeld/core';

const CACHE_KEY_CHARS = 24;
const MAX_ERROR = 300;
const CLONE_TIMEOUT_MS = 120_000;

export class LocalDirectorySource implements SourceConnector {
  readonly kind = 'local';
  private readonly allowedRoots: string[];
  /** `allowedRoots` empty = any directory the server user can read (desktop/single-user mode). */
  constructor(allowedRoots: string[] = []) { this.allowedRoots = allowedRoots.map(r => realpathSync(r)); }

  materialize(ref: string): Promise<{ root: string; name: string }> {
    const root = realpathSync(ref);
    if (!statSync(root).isDirectory()) return Promise.reject(new Error('local source must be a directory'));
    if (this.allowedRoots.length && !this.allowedRoots.some(a => root === a || root.startsWith(a + sep))) {
      return Promise.reject(new Error('directory is outside the allowed roots'));
    }
    return Promise.resolve({ root, name: basename(root) });
  }
}

export interface GitOptions { cacheDir: string; allowFileProtocol?: boolean; timeoutMs?: number }

export function checkGitUrl(ref: string, allowFile = false): URL {
  const url = new URL(ref);
  if (url.protocol === 'file:' && allowFile) return url;
  if (url.protocol !== 'https:') throw new Error('git sources must use https');
  if (url.username || url.password) throw new Error('git URLs must not embed credentials');
  return url;
}

export class GitSource implements SourceConnector {
  readonly kind = 'git';
  private readonly o: GitOptions;
  constructor(options: GitOptions) { this.o = options; }

  async materialize(ref: string): Promise<{ root: string; name: string }> {
    const url = checkGitUrl(ref, this.o.allowFileProtocol);
    const dir = join(this.o.cacheDir, createHash('sha256').update(url.href).digest('hex').slice(0, CACHE_KEY_CHARS));
    mkdirSync(this.o.cacheDir, { recursive: true });
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const protocols = this.o.allowFileProtocol ? ['-c', 'protocol.file.allow=always'] : [];
    const r = await execAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.symlinks=false', '-c', 'protocol.allow=never',
      '-c', 'protocol.https.allow=always', ...protocols, '-c', 'credential.helper=', 'clone', '--depth=1', '--no-recurse-submodules',
      '--single-branch', '--no-tags', '--', url.href, dir], {
      timeoutMs: this.o.timeoutMs ?? CLONE_TIMEOUT_MS,
      env: { PATH: process.env.PATH, HOME: this.o.cacheDir, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_LFS_SKIP_SMUDGE: '1',
        HTTPS_PROXY: process.env.HTTPS_PROXY, https_proxy: process.env.https_proxy, SSL_CERT_FILE: process.env.SSL_CERT_FILE, GIT_SSL_CAINFO: process.env.GIT_SSL_CAINFO },
    });
    if (!r.ok) throw new Error(`git clone failed: ${r.err.trim().slice(0, MAX_ERROR)}`);
    return { root: realpathSync(dir), name: basename(url.pathname).replace(/\.git$/, '') || 'repository' };
  }
}
