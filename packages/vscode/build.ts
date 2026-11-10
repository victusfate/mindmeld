// Bundles the extension into one CommonJS file. `vscode` is provided by the editor at runtime;
// @mindmeld/client (and its type-only core imports) are inlined, so the .vsix ships no node_modules.
import { build } from 'esbuild';

const here = new URL('.', import.meta.url).pathname;

await build({
  absWorkingDir: here,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'warning',
});
