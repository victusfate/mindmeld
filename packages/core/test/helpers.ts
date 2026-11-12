// Test-only helpers. HostProcessSandbox runs the harness as a plain child process so the trace pipeline can be
// tested without a container runtime. It is NOT isolation and is never exported from src/.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, ChatReply, ModelConnector, ModelStatus, SandboxConnector, SandboxResult, SandboxSpec, SandboxStatus } from '../src/index.ts';

export const FIXTURE = new URL('../../../fixtures/combat-game', import.meta.url).pathname;

export function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-fixture-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

export class HostProcessSandbox implements SandboxConnector {
  readonly name = 'test-host-process';
  readonly image = 'host';
  available = true;
  calls = 0;
  status(): Promise<SandboxStatus> {
    return Promise.resolve({ available: this.available, reason: this.available ? 'test' : 'test sandbox off', runtime: process.version });
  }
  run(spec: SandboxSpec): Promise<SandboxResult> {
    this.calls++;
    const [bin, script, ...rest] = spec.command;
    const child = spawn(bin === 'node' ? process.execPath : bin, [join(spec.workdir, script.replace(/^\/app\//, '')), ...rest], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    return new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), spec.timeoutMs);
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ exitCode: code, stdout, stderr, timedOut: signal === 'SIGKILL' }); });
    });
  }
}

export class ScriptedModel implements ModelConnector {
  readonly name = 'scripted';
  reply: (messages: ChatMessage[]) => string;
  available = true;
  seen: ChatMessage[][] = [];
  constructor(reply: (messages: ChatMessage[]) => string) { this.reply = reply; }
  status(): Promise<ModelStatus> { return Promise.resolve({ available: this.available, reason: 'scripted', model: 'scripted-1' }); }
  chat(messages: ChatMessage[]): Promise<ChatReply> {
    this.seen.push(messages);
    return Promise.resolve({ text: this.reply(messages), usage: { model: 'scripted-1', inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: null, costUsd: 0.001 } });
  }
}
