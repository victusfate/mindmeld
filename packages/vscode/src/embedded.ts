// The Studio backend running inside the extension host, as the desktop app runs it in Electron's main process
// (launchLocal: loopback, random port, fresh token), with evidence kept in the extension's global storage. In a WSL
// or remote window the extension host runs where the workspace lives, so the paths it imports are readable here.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bundledGrammarFiles } from '@mindmeld/core';
import { launchLocal, type LaunchOptions, type LocalBackend } from '@mindmeld/server';

/** A packaged .vsix carries the web UI and tree-sitter files in dist/ (build.ts); a source checkout uses the workspace's. */
function bundledAssets(extensionPath: string): Pick<LaunchOptions, 'webDir' | 'grammarFiles'> {
  const dist = join(extensionPath, 'dist');
  const grammars = bundledGrammarFiles(dist);
  const web = join(dist, 'web');   // only `node build.ts --package` copies the web UI
  return {
    ...(existsSync(web) ? { webDir: web } : {}),
    ...(existsSync(join(grammars.dir, 'manifest.json')) ? { grammarFiles: grammars } : {}),
  };
}

export const startEmbedded = (storageDir: string, extensionPath: string): Promise<LocalBackend> =>
  launchLocal({ env: process.env, dataDir: storageDir, ...bundledAssets(extensionPath) });
