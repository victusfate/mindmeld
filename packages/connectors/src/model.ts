// Local agent-CLI model connectors. Studio never holds model API keys: it shells out to an agent CLI the user
// has already installed and logged into (claude, codex, agy, pi). Each call:
//  - sends the prompt on stdin (never argv, so it is not visible in the process list or length-limited),
//  - disables the agent's tools where the CLI allows it (the model only interprets the evidence it is given),
//  - runs in a fresh empty temp directory with Studio's own secrets removed from the environment,
//  - is bounded by a timeout and an output cap, and its answer is still citation-checked by core.
import { spawn, spawnSync } from 'node:child_process';
import { execAsync } from './exec.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UNKNOWN_USAGE, type ChatMessage, type ChatReply, type ModelConnector, type ModelStatus, type ModelUsage, type ProviderLimit } from '@mindmeld/core';

export type CliProvider = 'claude' | 'codex' | 'agy' | 'pi';
export const CLI_PROVIDERS: CliProvider[] = ['claude', 'codex', 'agy', 'pi'];

const DEFAULT_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 1_000_000;
const MAX_REASON = 200;
/** `{out}` is replaced by a temp file path for CLIs that write their final message to a file. */
const OUT = '{out}';

type Parser = (stdout: string, file: string | null) => ChatReply;
interface Preset { args: string[]; parse: Parser; verified: boolean }
type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
function tryJson(text: string): Json | null {
  try { return obj(JSON.parse(text)); } catch { return null; }
}

/** Plain text; the CLI reports no usage, so every usage field is unknown. */
const parseText: Parser = (stdout, file) => ({ text: file ?? stdout, usage: UNKNOWN_USAGE });

const MS_PER_SECOND = 1000;
const isoFromEpoch = (v: unknown): string | null => (num(v) === null ? null : new Date((v as number) * MS_PER_SECOND).toISOString());

/** claude `rate_limit_event`s: {rate_limit_info: {unifiedWindows: {five_hour|seven_day: {utilization, resetsAt, status}}}}. */
export function claudeLimits(events: Json[]): ProviderLimit[] | null {
  const windows = new Map<string, ProviderLimit>();
  for (const e of events) {
    if (e.type !== 'rate_limit_event') continue;
    for (const [window, raw] of Object.entries(obj(obj(e.rate_limit_info).unifiedWindows))) {
      const w = obj(raw);
      windows.set(window, { window, utilization: num(w.utilization), resetsAt: isoFromEpoch(w.resetsAt), status: typeof w.status === 'string' ? w.status : null });
    }
  }
  return windows.size ? [...windows.values()] : null;
}

/** `claude -p --output-format stream-json --verbose` (JSONL; last `result` event has usage) or plain `json`. */
export const parseClaude: Parser = (stdout, file) => {
  const events = stdout.split('\n').map(tryJson).filter((e): e is Json => e !== null);
  const j = events.findLast(e => typeof e.result === 'string');
  if (!j || typeof j.result !== 'string') return parseText(stdout, file);
  const u = obj(j.usage);
  const usage: ModelUsage = {
    model: Object.keys(obj(j.modelUsage))[0] ?? null, inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens), cacheWriteTokens: num(u.cache_creation_input_tokens), costUsd: num(j.total_cost_usd),
  };
  return { text: j.result, usage, limits: claudeLimits(events) };
};

/** `codex exec --json -o FILE`: JSONL events on stdout, `turn.completed` carries usage; the answer is in FILE. */
export const parseCodex: Parser = (stdout, file) => {
  let usage: ModelUsage = UNKNOWN_USAGE;
  for (const line of stdout.split('\n')) {
    const e = tryJson(line);
    if (e?.type !== 'turn.completed') continue;
    const u = obj(e.usage);
    usage = { ...UNKNOWN_USAGE, inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens), cacheReadTokens: num(u.cached_input_tokens) };
  }
  return { text: file ?? '', usage };
};
/** `verified`: the preset is known to run the CLI with its tools off. Unverified presets are unavailable unless MINDMELD_MODEL_ARGS supplies a tools-off invocation. */
const PRESETS: Record<CliProvider, Preset> = {
  claude: { args: ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config'], parse: parseClaude, verified: true },
  codex: { args: ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-o', OUT, '-'], parse: parseCodex, verified: true },
  agy: { args: ['-p'], parse: parseText, verified: false },
  pi: { args: ['-p'], parse: parseText, verified: false },
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
  private readonly parse: Parser;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly verified: boolean;

  constructor(o: CliModelOptions) {
    const preset = PRESETS[o.provider];
    this.name = `${o.provider}-cli`;
    this.command = o.command ?? o.provider;
    this.args = o.args ?? preset.args;
    this.readsFile = this.args.includes(OUT);
    this.parse = preset.parse;
    this.verified = preset.verified || Boolean(o.args);
    this.model = o.model;
    this.timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private argv(out: string): string[] {
    const args = this.args.map(a => (a === OUT ? out : a));
    return this.model ? ['--model', this.model, ...args] : args;
  }

  async status(): Promise<ModelStatus> {
    const probe = await execAsync(this.command, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS, env: cleanEnv() });
    if (!probe.ok) return { available: false, reason: `${this.command} CLI not usable: ${probe.err.trim().slice(0, MAX_REASON)}`, model: this.model ?? null };
    if (!this.verified) {
      // Fail closed: repository text reaches the prompt, so an agent with shell/file tools must not receive it.
      return { available: false, reason: `${this.command}: no verified way to disable its tools; set MINDMELD_MODEL_ARGS to an invocation that runs with tools off (unverified)`, model: this.model ?? null };
    }
    return { available: true, reason: `${this.command} ${probe.out.trim().slice(0, MAX_REASON)}`, model: this.model ?? this.name };
  }

  chat(messages: ChatMessage[], options: { signal?: AbortSignal } = {}): Promise<ChatReply> {
    const cwd = mkdtempSync(join(tmpdir(), 'mindmeld-model-'));
    const out = join(cwd, 'answer.txt');
    return new Promise<ChatReply>((resolve, reject) => {
      const child = spawn(this.command, this.argv(out), { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal, timeout: this.timeoutMs, killSignal: 'SIGKILL' });
      let stdout = '', stderr = '';
      child.stdout.on('data', (c: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += c.toString('utf8'); });
      child.stderr.on('data', (c: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += c.toString('utf8'); });
      child.on('error', reject);
      child.stdin.on('error', reject);   // EPIPE when the CLI exits before reading the prompt
      child.on('close', code => {
        if (code !== 0) { reject(new Error(`${this.command} exited ${String(code)}: ${stderr.trim().slice(0, MAX_REASON)}`)); return; }
        try { resolve(this.parse(stdout, this.readsFile ? readFileSync(out, 'utf8') : null)); }
        catch (error) { reject(new Error(`${this.command} produced no readable answer: ${(error as Error).message}`)); }
      });
      child.stdin.end(flattenMessages(messages));
    }).finally(() => rmSync(cwd, { recursive: true, force: true }));
  }
}

/** First provider whose CLI answers `--version`, in the order given. Startup only (before the server listens), so it may block. */
export function detectProvider(order: CliProvider[] = CLI_PROVIDERS): CliProvider | null {
  return order.find(p => { const r = spawnSync(p, ['--version'], { timeout: PROBE_TIMEOUT_MS }); return !r.error && r.status === 0; }) ?? null;
}
