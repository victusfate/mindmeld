// Builds connectors from environment variables, shared by the server and the container image.
import { join } from 'node:path';
import type { ModelConnector, SandboxConnector, SourceConnector } from '@mindmeld/core';
import { DisabledSandbox, OciSandbox } from './sandbox.ts';
import { CLI_PROVIDERS, CliModel, detectProvider, type CliProvider } from './model.ts';
import { GitSource, LocalDirectorySource } from './source.ts';

export interface ConnectorConfig { sandbox: SandboxConnector; model: ModelConnector | null; sources: SourceConnector[]; notes: string[] }

const list = (v: string | undefined): string[] => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

function sandboxFromEnv(env: NodeJS.ProcessEnv): SandboxConnector {
  const kind = env.MINDMELD_SANDBOX ?? 'docker';
  if (kind === 'docker' || kind === 'podman') return new OciSandbox({ binary: kind, image: env.MINDMELD_SANDBOX_IMAGE, host: env.MINDMELD_DOCKER_HOST });
  return new DisabledSandbox(kind === 'none' ? 'sandbox disabled (MINDMELD_SANDBOX=none)' : `unknown sandbox ${kind}`);
}

/**
 * MINDMELD_MODEL_PROVIDER: auto (default: first installed of claude, codex, agy, pi) | claude | codex | agy | pi | none.
 * MINDMELD_MODEL: optional model name passed as --model. MINDMELD_MODEL_COMMAND / MINDMELD_MODEL_ARGS (JSON array,
 * `{out}` = answer file) override the CLI invocation. No API keys or HTTP endpoints are ever used.
 */
function modelFromEnv(env: NodeJS.ProcessEnv, notes: string[]): ModelConnector | null {
  const wanted = env.MINDMELD_MODEL_PROVIDER ?? 'auto';
  if (wanted === 'none') return null;
  if (wanted !== 'auto' && !CLI_PROVIDERS.includes(wanted as CliProvider)) {
    notes.push(`model disabled: unknown provider ${wanted} (use ${CLI_PROVIDERS.join(', ')}, auto or none)`);
    return null;
  }
  const provider = wanted === 'auto' ? detectProvider() : wanted as CliProvider;
  if (!provider) { notes.push(`model disabled: no local agent CLI found (${CLI_PROVIDERS.join(', ')})`); return null; }
  let args: string[] | undefined;
  try { args = env.MINDMELD_MODEL_ARGS ? JSON.parse(env.MINDMELD_MODEL_ARGS) as string[] : undefined; }
  catch { notes.push('MINDMELD_MODEL_ARGS is not a JSON array; using the preset'); }
  return new CliModel({ provider, command: env.MINDMELD_MODEL_COMMAND, args, model: env.MINDMELD_MODEL });
}

export function connectorsFromEnv(env: NodeJS.ProcessEnv, dataDir: string): ConnectorConfig {
  const notes: string[] = [];
  const sandbox = sandboxFromEnv(env);
  const model = modelFromEnv(env, notes);
  const sources: SourceConnector[] = [new LocalDirectorySource(list(env.MINDMELD_ALLOWED_ROOTS))];
  if (env.MINDMELD_GIT !== 'off') sources.push(new GitSource({ cacheDir: join(dataDir, 'repos') }));
  return { sandbox, model, sources, notes };
}
