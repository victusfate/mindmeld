// Local agent-CLI model connectors. Studio never holds model API keys: it shells out to an agent CLI the user
// has already installed and logged into (claude, codex, agy, pi). Each call:
//  - sends the prompt on stdin (never argv, so it is not visible in the process list or length-limited),
//  - disables the agent's tools where the CLI allows it (the model only interprets the evidence it is given),
//  - runs in a fresh empty temp directory with Studio's own secrets removed from the environment,
//  - is bounded by a timeout and an output cap, and its answer is still citation-checked by core.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, ModelConnector, ModelStatus } from '@mindmeld/core';

export type CliProvider = 'claude' | 'codex' | 'agy' | 'pi';
export const CLI_PROVIDERS: CliProvider[] = ['claude', 'codex', 'agy', 'pi'];

const DEFAULT_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 1_000_000;
const MAX_REASON = 200;
/** `{out}` is replaced by a temp file path for CLIs that write their final message to a file. */
const OUT = '{out}';

interface Preset { args: string[]; readsFile: boolean; verified: boolean }
/** `verified`: flags checked against the CLI's help. Unverified presets can be replaced with MINDMELD_MODEL_ARGS. */
const PRESETS: Record<CliProvider, Preset> = {
  claude: { args: ['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config'], readsFile: false, verified: true },
  codex: { args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-o', OUT, '-'], readsFile: true, verified: true },
  agy: { args: ['-p'], readsFile: false, verified: false },
  pi: { args: ['-p'], readsFile: false, verified: false },
};
const SECRET_ENV = /^MINDMELD_(TOKEN|.*KEY.*)$/;

export interface CliModelOptions { provider: CliProvider; command?: string; args?: string[]; model?: string; timeoutMs?: number }

export function flattenMessages(messages: ChatMessage[]): string {
  return messages.map(m => (m.role === 'system' ? `# Instructions\n${m.content}` : m.role === 'user' ? `# Request\n${m.content}` : `# Previous answer\n${m.content}`)).join('\n\n');
}

function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k)));
}

export class CliModel implements ModelConnector {
  readonly name: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly readsFile: boolean;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly verified: boolean;

  constructor(o: CliModelOptions) {
    const preset = PRESETS[o.provider];
    this.name = `${o.provider}-cli`;
    this.command = o.command ?? o.provider;
    this.args = o.args ?? preset.args;
    this.readsFile = this.args.includes(OUT);
    this.verified = !o.args && preset.verified;
    this.model = o.model;
    this.timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private argv(out: string): string[] {
    const args = this.args.map(a => (a === OUT ? out : a));
    return this.model ? ['--model', this.model, ...args] : args;
  }

  status(): Promise<ModelStatus> {
    const probe = spawnSync(this.command, ['--version'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, env: cleanEnv() });
    if (probe.error || probe.status !== 0) {
      const why = probe.error?.message ?? probe.stderr;
      return Promise.resolve({ available: false, reason: `${this.command} CLI not usable: ${why.trim().slice(0, MAX_REASON)}`, model: this.model ?? null });
    }
    const note = this.verified ? '' : ' (unverified flags; set MINDMELD_MODEL_ARGS if calls fail)';
    return Promise.resolve({ available: true, reason: `${this.command} ${probe.stdout.trim().slice(0, MAX_REASON)}${note}`, model: this.model ?? this.name });
  }

  chat(messages: ChatMessage[], options: { signal?: AbortSignal } = {}): Promise<string> {
    const cwd = mkdtempSync(join(tmpdir(), 'mindmeld-model-'));
    const out = join(cwd, 'answer.txt');
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.command, this.argv(out), { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal, timeout: this.timeoutMs, killSignal: 'SIGKILL' });
      let stdout = '', stderr = '';
      child.stdout.on('data', (c: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += c.toString('utf8'); });
      child.stderr.on('data', (c: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += c.toString('utf8'); });
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) { reject(new Error(`${this.command} exited ${String(code)}: ${stderr.trim().slice(0, MAX_REASON)}`)); return; }
        resolve(this.readsFile ? readFileSync(out, 'utf8') : stdout);
      });
      child.stdin.end(flattenMessages(messages));
    }).finally(() => rmSync(cwd, { recursive: true, force: true }));
  }
}

/** First provider whose CLI answers `--version`, in the order given. */
export function detectProvider(order: CliProvider[] = CLI_PROVIDERS): CliProvider | null {
  return order.find(p => { const r = spawnSync(p, ['--version'], { timeout: PROBE_TIMEOUT_MS }); return !r.error && r.status === 0; }) ?? null;
}
