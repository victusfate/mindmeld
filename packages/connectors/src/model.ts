// Local model connectors. By default only loopback endpoints are accepted so repository context never
// leaves the machine; other hosts must be named explicitly (e.g. a compose service called `ollama`).
import type { ChatMessage, ModelConnector, ModelStatus } from '@mindmeld/core';

const PROBE_TIMEOUT_MS = 3000;
const DEFAULT_CHAT_TIMEOUT_MS = 120_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface ModelOptions { endpoint: string; model: string; allowHosts?: string[]; apiKey?: string; timeoutMs?: number }

export function checkEndpoint(endpoint: string, allowHosts: string[] = []): URL {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('model endpoint must be http(s)');
  if (url.username || url.password) throw new Error('model endpoint must not embed credentials');
  if (!LOOPBACK.has(url.hostname) && !allowHosts.includes(url.hostname)) {
    throw new Error(`model endpoint host ${url.hostname} is not local; add it to MINDMELD_MODEL_ALLOW_HOSTS to permit it`);
  }
  return url;
}

abstract class HttpModel implements ModelConnector {
  abstract readonly name: string;
  protected readonly base: URL;
  protected readonly model: string;
  protected readonly apiKey: string | undefined;
  protected readonly timeoutMs: number;

  constructor(o: ModelOptions) {
    this.base = checkEndpoint(o.endpoint, o.allowHosts);
    this.model = o.model;
    this.apiKey = o.apiKey;
    this.timeoutMs = o.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
  }

  protected async request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(new URL(path, this.base), {
      method: body === undefined ? 'GET' : 'POST', headers, redirect: 'error',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`${this.name} ${path} returned HTTP ${res.status}`);
    return res.json();
  }

  protected abstract listModels(): Promise<string[]>;
  abstract chat(messages: ChatMessage[], options?: { signal?: AbortSignal }): Promise<string>;

  async status(): Promise<ModelStatus> {
    try {
      const models = await this.listModels();
      if (!models.some(m => m === this.model || m.split(':')[0] === this.model)) {
        return { available: false, reason: `model ${this.model} not found at ${this.base.origin} (have: ${models.slice(0, 5).join(', ') || 'none'})`, model: this.model };
      }
      return { available: true, reason: `${this.name} at ${this.base.origin}`, model: this.model };
    } catch (error) {
      return { available: false, reason: `${this.name} unreachable at ${this.base.origin}: ${(error as Error).message}`, model: this.model };
    }
  }
}

export class OllamaModel extends HttpModel {
  readonly name = 'ollama';
  protected async listModels(): Promise<string[]> {
    const body = await this.request('/api/tags', undefined, AbortSignal.timeout(PROBE_TIMEOUT_MS)) as { models?: { name?: string }[] };
    return (body.models ?? []).map(m => String(m.name));
  }
  async chat(messages: ChatMessage[], options: { signal?: AbortSignal } = {}): Promise<string> {
    const body = await this.request('/api/chat', { model: this.model, messages, stream: false, options: { temperature: 0 } }, options.signal) as { message?: { content?: string } };
    return String(body.message?.content ?? '');
  }
}

export class OpenAICompatibleModel extends HttpModel {
  readonly name = 'openai-compatible';
  protected async listModels(): Promise<string[]> {
    const body = await this.request('/v1/models', undefined, AbortSignal.timeout(PROBE_TIMEOUT_MS)) as { data?: { id?: string }[] };
    return (body.data ?? []).map(m => String(m.id));
  }
  async chat(messages: ChatMessage[], options: { signal?: AbortSignal } = {}): Promise<string> {
    const body = await this.request('/v1/chat/completions', { model: this.model, messages, temperature: 0 }, options.signal) as { choices?: { message?: { content?: string } }[] };
    return String(body.choices?.[0]?.message?.content ?? '');
  }
}
