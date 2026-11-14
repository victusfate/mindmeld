// Shared start-up used by the CLI and the container image.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceStore, loadGrammars, Studio } from '@mindmeld/core';
import { connectorsFromEnv } from '@mindmeld/connectors';
import { startServer, type RunningServer } from './app.ts';

export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface LaunchOptions {
  env?: NodeJS.ProcessEnv; dataDir?: string; port?: number; host?: string; token?: string;
}

const DEFAULT_PORT = 8787;
export { DEFAULT_PORT };
const hostList = (v: string | undefined): string[] => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
const envPort = (env: NodeJS.ProcessEnv): number => (env.MINDMELD_PORT ? Number(env.MINDMELD_PORT) : DEFAULT_PORT);

export async function launch(o: LaunchOptions = {}): Promise<{ studio: Studio; running: RunningServer; notes: string[] }> {
  const env = o.env ?? process.env;
  const dataDir = o.dataDir ?? env.MINDMELD_DATA_DIR ?? join(homedir(), '.mindmeld');
  const connectors = connectorsFromEnv(env, dataDir);
  const grammars = await loadGrammars();
  const studio = new Studio({ store: new EvidenceStore(join(dataDir, 'evidence.db')), ...connectors, runDir: env.MINDMELD_RUN_DIR, grammars });
  const running = await startServer({
    studio, host: o.host ?? env.MINDMELD_HOST, port: o.port ?? envPort(env),
    token: o.token ?? env.MINDMELD_TOKEN, webDir: env.MINDMELD_WEB_DIR ?? DEFAULT_WEB_DIR,
    extraHosts: hostList(env.MINDMELD_ALLOWED_HOSTS),
  });
  return { studio, running, notes: connectors.notes };
}
