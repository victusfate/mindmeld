// OCI sandbox connectors (Docker, Podman). Each run gets a fresh, network-less, read-only container with
// dropped capabilities, bounded memory/pids/cpu and a hard kill timeout. The source is mounted read-only.
// Images are never pulled during a run; a missing image makes execution unavailable, not unsafe.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { SandboxConnector, SandboxResult, SandboxSpec, SandboxStatus } from '@mindmeld/core';

export const DEFAULT_IMAGE = 'node:26-alpine';
const MAX_OUTPUT = 2_000_000;
const MAX_STDERR = 20_000;
const MAX_REASON = 200;
const MS_PER_SECOND = 1000;
const HOST_BACKSTOP_MS = 5000;
/** Exit status of a process killed by SIGKILL (128 + 9), what `timeout -s KILL` reports. */
const KILLED_EXIT = 137;
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];

export interface OciOptions { binary?: 'docker' | 'podman'; image?: string; host?: string }

export class OciSandbox implements SandboxConnector {
  readonly name: string;
  readonly image: string;
  private readonly binary: string;
  private readonly host: string | undefined;

  constructor(options: OciOptions = {}) {
    this.binary = options.binary ?? 'docker';
    this.image = options.image ?? DEFAULT_IMAGE;
    this.host = options.host;
    this.name = `${this.binary}-oci`;
  }

  private env(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'CONTAINER_HOST']) delete env[key];
    if (this.host) env.DOCKER_HOST = this.host; else delete env.DOCKER_HOST;
    return env;
  }

  private cli(args: string[], timeout = 15_000): { ok: boolean; out: string; err: string } {
    const r = spawnSync(this.binary, args, { env: this.env(), encoding: 'utf8', timeout });
    return { ok: !r.error && r.status === 0, out: r.stdout ?? '', err: r.error?.message ?? r.stderr ?? '' };
  }

  status(): Promise<SandboxStatus> {
    return Promise.resolve(this.probe());
  }

  private probe(): SandboxStatus {
    const version = this.cli(['version', '--format', '{{.Server.Version}}']);
    if (!version.ok) return { available: false, reason: `${this.binary} daemon not reachable: ${version.err.trim().slice(0, MAX_REASON)}`, runtime: null };
    const image = this.cli(['image', 'inspect', '--format', '{{.Id}}', this.image]);
    if (!image.ok) return { available: false, reason: `sandbox image ${this.image} is not present locally (prepare it once with \`${this.binary} pull ${this.image}\`)`, runtime: null };
    return { available: true, reason: `${this.binary} ${version.out.trim()} · image ${image.out.trim().slice(0, 19)}`, runtime: null };
  }

  /** Exposed for tests: the exact isolation flags every run uses. */
  runArgs(spec: SandboxSpec, name: string): string[] {
    const dir = realpathSync(spec.workdir);
    if (dir.includes(',')) throw new Error('sandbox workdir cannot contain commas');
    const seconds = Math.max(1, Math.ceil(spec.timeoutMs / MS_PER_SECOND));
    return ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--pids-limit=64', `--memory=${spec.memoryMb}m`, `--memory-swap=${spec.memoryMb}m`, '--cpus=1',
      '--user=65534:65534', '--tmpfs=/tmp:rw,noexec,nosuid,size=16m', '--workdir=/tmp', '--env=HOME=/tmp',
      ...PROXY_VARS.map(v => `--env=${v}=`), '--mount', `type=bind,src=${dir},dst=/app,readonly`,
      this.image, 'timeout', '-s', 'KILL', String(seconds), ...spec.command];
  }

  run(spec: SandboxSpec): Promise<SandboxResult> {
    const name = `mindmeld-${randomUUID()}`;
    const args = this.runArgs(spec, name);
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', timedOut = false;
      const cap = (acc: string, chunk: Buffer): string => (acc.length < MAX_OUTPUT ? acc + chunk.toString('utf8') : acc);
      child.stdout.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
      child.stderr.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
      // Host-side backstop: the in-container `timeout` should fire first; this kills the client and the named container.
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, spec.timeoutMs + HOST_BACKSTOP_MS);
      child.on('error', error => { clearTimeout(timer); reject(new Error(`sandbox failed to start (no unsafe fallback): ${error.message}`)); });
      child.on('close', code => {
        clearTimeout(timer);
        this.cli(['rm', '--force', name]);   // only this invocation's own randomly named container
        // `timeout -s KILL` exits 137 when it kills the entry.
        resolve({ exitCode: code, stdout, stderr: stderr.slice(0, MAX_STDERR), timedOut: timedOut || code === KILLED_EXIT });
      });
    });
  }
}

/** Used when isolation is disabled or unavailable: static inspection still works, execution fails closed. */
export class DisabledSandbox implements SandboxConnector {
  readonly name = 'disabled';
  readonly image = 'none';
  readonly reason: string;
  constructor(reason = 'sandbox disabled by configuration') { this.reason = reason; }
  status(): Promise<SandboxStatus> { return Promise.resolve({ available: false, reason: this.reason, runtime: null }); }
  run(): Promise<SandboxResult> { return Promise.reject(new Error(`execution unavailable: ${this.reason}`)); }
}
