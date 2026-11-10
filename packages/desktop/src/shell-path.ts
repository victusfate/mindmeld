// GUI-launched apps (Finder, Dock, desktop launchers) inherit a minimal PATH, so the local agent CLIs
// (claude, codex, agy, pi) that the model connector auto-detects would be invisible. At startup we ask the
// user's login shell for its PATH once, with a timeout, and merge it in before the backend starts.
import { execFile } from 'node:child_process';

const SHELL_TIMEOUT_MS = 3000;
const FALLBACK_SHELL = '/bin/sh';

/**
 * Login-shell entries first (the user's intended order), then any current entries the shell did not list.
 * Empty and duplicate entries are dropped.
 */
export function mergePath(current: string | undefined, login: string | undefined, delimiter: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of [...(login ?? '').split(delimiter), ...(current ?? '').split(delimiter)]) {
    const dir = entry.trim();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(delimiter);
}

/** The last non-empty line of the shell's output; profile scripts may print banners before it. */
export function lastLine(stdout: string): string {
  return stdout.split('\n').map(line => line.trim()).filter(Boolean).at(-1) ?? '';
}

/** Resolves the login shell's PATH, or null on Windows, on timeout or on any failure. Never throws. */
export function loginShellPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | null> {
  if (platform === 'win32') return Promise.resolve(null);
  return new Promise(resolve => {
    const shell = env.SHELL || FALLBACK_SHELL;
    execFile(shell, ['-lc', 'printf %s "$PATH"'], { timeout: SHELL_TIMEOUT_MS, env }, (error, stdout) => {
      resolve(error ? null : lastLine(stdout) || null);
    });
  });
}
