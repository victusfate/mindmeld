// Non-blocking child-process call for request-time work: the server keeps answering while the command runs.
import { execFile } from 'node:child_process';

export interface ExecResult { ok: boolean; out: string; err: string }

const MAX_BUFFER = 10_000_000;

/** Runs `command args` without blocking the event loop. Never rejects: failures (spawn error, non-zero exit, timeout) are `ok: false`. */
export function execAsync(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(command, args, { env: options.env, timeout: options.timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => resolve({ ok: !error, out: stdout, err: error && !stderr ? error.message : stderr }));
  });
}
