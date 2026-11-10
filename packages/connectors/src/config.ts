// Builds connectors from environment variables, shared by the server, desktop app and container image.
import { join } from 'node:path';
import type { ModelConnector, SandboxConnector, SourceConnector } from '@mindmeld/core';
import { DisabledSandbox, OciSandbox } from './sandbox.ts';
import { OllamaModel, OpenAICompatibleModel } from './model.ts';
import { GitSource, LocalDirectorySource } from './source.ts';

export interface ConnectorConfig { sandbox: SandboxConnector; model: ModelConnector | null; sources: SourceConnector[]; notes: string[] }

const list = (v: string | undefined): string[] => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

const DEFAULT_ENDPOINTS: Record<string, string> = { ollama: 'http://127.0.0.1:11434', openai: 'http://127.0.0.1:8080' };
export const DEFAULT_MODEL = 'qwen2.5-coder:7b';

function sandboxFromEnv(env: NodeJS.ProcessEnv): SandboxConnector {
  const kind = env.MINDMELD_SANDBOX ?? 'docker';
  if (kind === 'docker' || kind === 'podman') return new OciSandbox({ binary: kind, image: env.MINDMELD_SANDBOX_IMAGE, host: env.MINDMELD_DOCKER_HOST });
  return new DisabledSandbox(kind === 'none' ? 'sandbox disabled (MINDMELD_SANDBOX=none)' : `unknown sandbox ${kind}`);
}

function modelFromEnv(env: NodeJS.ProcessEnv, notes: string[]): ModelConnector | null {
  const provider = env.MINDMELD_MODEL_PROVIDER ?? 'ollama';
  if (provider === 'none') return null;
  const options = {
    endpoint: env.MINDMELD_MODEL_ENDPOINT ?? DEFAULT_ENDPOINTS[provider] ?? DEFAULT_ENDPOINTS.ollama,
    model: env.MINDMELD_MODEL ?? DEFAULT_MODEL, allowHosts: list(env.MINDMELD_MODEL_ALLOW_HOSTS), apiKey: env.MINDMELD_MODEL_API_KEY,
  };
  try { return provider === 'openai' ? new OpenAICompatibleModel(options) : new OllamaModel(options); }
  catch (error) { notes.push(`model disabled: ${(error as Error).message}`); return null; }
}

export function connectorsFromEnv(env: NodeJS.ProcessEnv, dataDir: string): ConnectorConfig {
  const notes: string[] = [];
  const sandbox = sandboxFromEnv(env);
  const model = modelFromEnv(env, notes);
  const sources: SourceConnector[] = [new LocalDirectorySource(list(env.MINDMELD_ALLOWED_ROOTS))];
  if (env.MINDMELD_GIT !== 'off') sources.push(new GitSource({ cacheDir: join(dataDir, 'repos') }));
  return { sandbox, model, sources, notes };
}
