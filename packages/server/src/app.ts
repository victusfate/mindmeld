// Localhost HTTP backend. Every route maps onto one Studio method; Studio owns all evidence rules.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { ModelUnavailableError, NotFoundError, SandboxUnavailableError, TraceRejectedError, ValidationError, type Studio } from '@mindmeld/core';
import { checkRequest, COOKIE, HTTP, sameToken, securityHeaders, type Policy } from './security.ts';

export const API_VERSION = 1;
const MAX_BODY = 2_000_000;
const MAX_BUNDLE_BODY = 60_000_000;
const TOKEN_BYTES = 24;
const REQUEST_TIMEOUT_MS = 180_000;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

export interface ServerOptions {
  studio: Studio;
  host?: string;
  port?: number;
  token?: string;
  webDir?: string;
  /** Extra Host header values, e.g. a container's published name. Loopback names are always allowed. */
  extraHosts?: string[];
}
export interface RunningServer { server: Server; url: string; token: string; close(): Promise<void> }

type Params = Record<string, string>;
type Handler = (ctx: { req: IncomingMessage; params: Params; query: URLSearchParams; body: () => Promise<unknown> }) => unknown;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; bodyLimit: number }

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function route(method: string, path: string, handler: Handler, bodyLimit = MAX_BODY): Route {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; })}$`);
  return { method, pattern, keys, handler, bodyLimit };
}

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { req.removeAllListeners('data'); req.resume(); reject(new HttpError(HTTP.tooLarge, 'request body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(HTTP.badRequest, 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const field = (body: unknown, key: string): unknown => (body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined);
function str(body: unknown, key: string): string {
  const v = field(body, key);
  if (typeof v !== 'string' || !v) throw new HttpError(HTTP.badRequest, `${key} is required`);
  return v;
}

function routes(studio: Studio): Route[] {
  return [
    route('GET', '/api/status', async () => ({ apiVersion: API_VERSION, ...(await studio.status()) })),
    route('GET', '/api/projects', () => studio.store.listProjects()),
    route('POST', '/api/projects', async ({ body }) => {
      const b = await body();
      return studio.addProject({ kind: str(b, 'kind'), ref: str(b, 'ref'), name: typeof field(b, 'name') === 'string' ? String(field(b, 'name')) : undefined });
    }),
    route('GET', '/api/projects/:id', ({ params }) => ({ project: studio.store.getProject(params.id), snapshot: studio.snapshot(params.id) })),
    route('POST', '/api/projects/:id/refresh', ({ params }) => studio.refresh(params.id)),
    route('GET', '/api/projects/:id/graph', ({ params }) => studio.graph(params.id)),
    route('GET', '/api/projects/:id/source', ({ params, query }) => studio.source(params.id, query.get('path') ?? '')),
    route('GET', '/api/projects/:id/entries', ({ params }) => studio.entries(params.id)),
    route('POST', '/api/projects/:id/entries', async ({ params, body }) => {
      const b = await body();
      return studio.addEntry(params.id, str(b, 'symbolId'), typeof field(b, 'note') === 'string' ? String(field(b, 'note')) : '');
    }),
    route('GET', '/api/projects/:id/runs', ({ params }) => studio.runs(params.id)),
    route('POST', '/api/projects/:id/runs', async ({ params, body }) => {
      const b = await body();
      const timeoutMs = field(b, 'timeoutMs');
      return studio.execute(params.id, str(b, 'entryId'), field(b, 'inputs') ?? [], { timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined });
    }),
    route('POST', '/api/projects/:id/ask', async ({ params, body }) => studio.ask(params.id, str(await body(), 'question'))),
    route('GET', '/api/projects/:id/citation', ({ params, query }) => {
      const kind = query.get('kind');
      if (kind !== 'symbol' && kind !== 'event') throw new HttpError(HTTP.badRequest, 'kind must be symbol or event');
      return studio.resolve(params.id, kind, query.get('ref') ?? '', query.get('hash') ?? undefined);
    }),
    route('GET', '/api/projects/:id/bundle', ({ params }) => studio.exportBundle(params.id)),
    route('POST', '/api/bundles', async ({ body }) => studio.importBundle(await body()), MAX_BUNDLE_BODY),
    route('GET', '/api/runs/:id', ({ params }) => studio.run(params.id)),
    route('GET', '/api/runs/:a/diff/:b', ({ params }) => studio.diff(params.a, params.b)),
  ];
}

function errorStatus(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof NotFoundError) return HTTP.notFound;
  if (error instanceof SandboxUnavailableError || error instanceof ModelUnavailableError) return HTTP.unavailable;
  if (error instanceof TraceRejectedError) return HTTP.unprocessable;
  if (error instanceof ValidationError) return HTTP.badRequest;
  const message = error instanceof Error ? error.message : '';
  return /^(bundle:|git |local source|directory is outside|unknown source|question must|inputs must|entry must)/.test(message) ? HTTP.badRequest : 500;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function serveStatic(res: ServerResponse, webDir: string | undefined, pathname: string): void {
  const index = webDir ? join(webDir, 'index.html') : '';
  if (!webDir || !existsSync(index)) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Mind Meld Studio</title><p>The web UI is not built. Run <code>npm run build -w @mindmeld/web</code>.</p>');
    return;
  }
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(webDir, rel);
  if (!file.startsWith(webDir + sep) || !existsSync(file) || !statSync(file).isFile()) file = index;   // SPA fallback
  res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}

function login(req: IncomingMessage, res: ServerResponse, url: URL, policy: Policy): void {
  if (!sameToken(url.searchParams.get('token') ?? undefined, policy.token)) { send(res, HTTP.unauthorized, { error: 'invalid token' }); return; }
  res.statusCode = HTTP.seeOther;
  res.setHeader('set-cookie', `${COOKIE}=${policy.token}; HttpOnly; SameSite=Strict; Path=/`);
  res.setHeader('location', '/');
  res.end();
}

async function dispatch(req: IncomingMessage, res: ServerResponse, table: Route[], url: URL): Promise<void> {
  for (const r of table) {
    const m = r.method === req.method ? r.pattern.exec(url.pathname) : null;
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      send(res, HTTP.ok, await r.handler({ req, params, query: url.searchParams, body: () => readBody(req, r.bodyLimit) }));
    } catch (error) {
      const status = errorStatus(error);
      if (status === HTTP.internal) console.error(error);
      send(res, status, { error: status === HTTP.internal ? 'internal error' : (error as Error).message });
    }
    return;
  }
  send(res, HTTP.notFound, { error: 'no such endpoint' });
}

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? randomBytes(TOKEN_BYTES).toString('base64url');
  const table = routes(options.studio);
  const policy: Policy = { token, allowedHosts: new Set(), allowedOrigins: new Set() };
  const server = createServer((req, res) => {
    securityHeaders(res);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');
    const denied = checkRequest(req, policy, isApi && url.pathname !== '/api/health');
    if (denied) { send(res, denied.status, { error: denied.message }); return; }
    if (url.pathname === '/api/health') { send(res, HTTP.ok, { ok: true, apiVersion: API_VERSION }); return; }
    if (url.pathname === '/auth') { login(req, res, url, policy); return; }
    if (isApi) { void dispatch(req, res, table, url); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, HTTP.notAllowed, { error: 'method not allowed' }); return; }
    serveStatic(res, options.webDir, url.pathname);
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const port = (server.address() as { port: number }).port;
      for (const h of ['127.0.0.1', 'localhost', '[::1]', ...(options.extraHosts ?? [])]) {
        policy.allowedHosts.add(`${h}:${port}`);
        policy.allowedOrigins.add(`http://${h}:${port}`);
      }
      const url = `http://127.0.0.1:${port}`;
      resolve({ server, url, token, close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }) });
    });
  });
}
