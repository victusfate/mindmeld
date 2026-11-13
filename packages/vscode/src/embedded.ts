// The Studio backend running inside the extension host, as the desktop app runs it in Electron's main process:
// 127.0.0.1 on a random port with a fresh token, evidence kept in the extension's global storage. In a WSL or
// remote window the extension host runs where the workspace lives, so the paths it imports are readable here.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type LaunchOptions } from '@mindmeld/server';

const TOKEN_BYTES = 32;

export interface EmbeddedBackend { url: string; token: string; close(): Promise<void> }

/** A packaged .vsix carries the web UI and tree-sitter files in dist/ (build.ts); a source checkout uses the workspace's. */
function bundledAssets(extensionPath: string): Pick<LaunchOptions, 'webDir' | 'grammarFiles'> {
  const dist = join(extensionPath, 'dist');
  if (!existsSync(join(dist, 'grammars', 'manifest.json'))) return {};
  return { webDir: join(dist, 'web'), grammarFiles: { dir: join(dist, 'grammars'), runtimeWasm: join(dist, 'web-tree-sitter.wasm') } };
}

export async function startEmbedded(storageDir: string, extensionPath: string): Promise<EmbeddedBackend> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const { studio, running } = await launch({ env: process.env, dataDir: storageDir, host: '127.0.0.1', port: 0, token, ...bundledAssets(extensionPath) });
  return {
    url: running.url,
    token: running.token,
    close: async () => { try { await running.close(); } finally { studio.store.close(); } },
  };
}
