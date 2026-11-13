// Shared start-up used by the CLI, the container image and the desktop app.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceStore, loadGrammars, Studio, type GrammarFiles } from '@mindmeld/core';
import { connectorsFromEnv } from '@mindmeld/connectors';
import { startServer, type RunningServer } from './app.ts';

export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface LaunchOptions {
  env?: NodeJS.ProcessEnv; dataDir?: string; port?: number; host?: string; token?: string; webDir?: string;
  /** Bundled apps (desktop, VS Code) ship the tree-sitter files beside their bundle. */
  grammarFiles?: GrammarFiles;
}

const DEFAULT_PORT = 8787;
export { DEFAULT_PORT };
const hostList = (v: string | undefined): string[] => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
const envPort = (env: NodeJS.ProcessEnv): number => (env.MINDMELD_PORT ? Number(env.MINDMELD_PORT) : DEFAULT_PORT);

export async function launch(o: LaunchOptions = {}): Promise<{ studio: Studio; running: RunningServer; notes: string[] }> {
  const env = o.env ?? process.env;
  const dataDir = o.dataDir ?? env.MINDMELD_DATA_DIR ?? join(homedir(), '.mindmeld');
  const connectors = connectorsFromEnv(env, dataDir);
  const grammars = await loadGrammars(o.grammarFiles);
  const studio = new Studio({ store: new EvidenceStore(join(dataDir, 'evidence.db')), ...connectors, runDir: env.MINDMELD_RUN_DIR, grammars });
  const running = await startServer({
    studio, host: o.host ?? env.MINDMELD_HOST, port: o.port ?? envPort(env),
    token: o.token ?? env.MINDMELD_TOKEN, webDir: o.webDir ?? env.MINDMELD_WEB_DIR ?? DEFAULT_WEB_DIR,
    extraHosts: hostList(env.MINDMELD_ALLOWED_HOSTS),
  });
  return { studio, running, notes: connectors.notes };
}

export interface LocalBackend { studio: Studio; url: string; token: string; notes: string[]; close(): Promise<void> }

/** The backend a desktop app or editor runs for itself: loopback only, a random port and a fresh token, so it never
 * collides with a shared server on the default port. `close()` stops the HTTP server, then releases the store. */
export async function launchLocal(o: Omit<LaunchOptions, 'host' | 'port' | 'token'>): Promise<LocalBackend> {
  const { studio, running, notes } = await launch({ ...o, host: '127.0.0.1', port: 0 });
  return {
    studio, url: running.url, token: running.token, notes,
    close: async () => { try { await running.close(); } finally { studio.store.close(); } },
  };
}
