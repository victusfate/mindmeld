// Shared start-up used by the CLI and the container image.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceStore, loadGrammars, Studio } from '@mindmeld/core';
import { connectorsFromEnv } from '@mindmeld/connectors';
import { startServer, type RunningServer, type ServerOptions } from './app.ts';

export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface LaunchOptions {
  env?: NodeJS.ProcessEnv; dataDir?: string; port?: number; host?: string; token?: string;
  /** When no port was asked for (option or MINDMELD_PORT) and the default is busy, listen on a free port instead. */
  portFallback?: boolean;
}

const DEFAULT_PORT = 8787;
export { DEFAULT_PORT };
export const PORT_FALLBACK_NOTE = 'the default port is in use; using a free port';
const hostList = (v: string | undefined): string[] => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
const askedPort = (o: LaunchOptions, env: NodeJS.ProcessEnv): number | undefined => o.port ?? (env.MINDMELD_PORT ? Number(env.MINDMELD_PORT) : undefined);

/** The server package's version, reported to MCP clients. */
export const packageVersion = (): string =>
  (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** Where evidence lives: the explicit directory, else MINDMELD_DATA_DIR, else ~/.mindmeld. */
export const dataDirFrom = (env: NodeJS.ProcessEnv, dataDir?: string): string => dataDir ?? env.MINDMELD_DATA_DIR ?? join(homedir(), '.mindmeld');

async function listen(options: ServerOptions, fallback: boolean, notes: string[]): Promise<RunningServer> {
  try { return await startServer(options); } catch (error) {
    if (!fallback || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    notes.push(PORT_FALLBACK_NOTE);
    return startServer({ ...options, port: 0 });
  }
}

/** Studio on the data directory with connectors from the environment, without an HTTP server (the MCP server). */
export async function openStudio(o: Pick<LaunchOptions, 'env' | 'dataDir'> = {}): Promise<{ studio: Studio; notes: string[] }> {
  const env = o.env ?? process.env;
  const dataDir = dataDirFrom(env, o.dataDir);
  const connectors = connectorsFromEnv(env, dataDir);
  const grammars = await loadGrammars();
  const studio = new Studio({ store: new EvidenceStore(join(dataDir, 'evidence.db')), ...connectors, runDir: env.MINDMELD_RUN_DIR, grammars });
  return { studio, notes: [...connectors.notes] };
}

export async function launch(o: LaunchOptions = {}): Promise<{ studio: Studio; running: RunningServer; notes: string[] }> {
  const env = o.env ?? process.env;
  const { studio, notes } = await openStudio(o);
  const port = askedPort(o, env);
  const running = await listen({
    studio, host: o.host ?? env.MINDMELD_HOST, port: port ?? DEFAULT_PORT,
    token: o.token ?? env.MINDMELD_TOKEN, webDir: env.MINDMELD_WEB_DIR ?? DEFAULT_WEB_DIR,
    extraHosts: hostList(env.MINDMELD_ALLOWED_HOSTS),
  }, Boolean(o.portFallback) && port === undefined, notes).catch((error: unknown) => { studio.store.close(); throw error; });
  return { studio, running, notes };
}
