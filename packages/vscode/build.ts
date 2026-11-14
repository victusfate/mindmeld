// Bundles the extension into one CommonJS file. `vscode` is provided by the editor at runtime; everything else —
// including the embedded Studio backend (@mindmeld/server, core, connectors, `typescript`) — is inlined, so the
// .vsix ships no node_modules. Run: node build.ts [--package]
import { build } from 'esbuild';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyGrammarAssets } from '../core/scripts/grammar-assets.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const webDist = fileURLToPath(new URL('../web/dist', import.meta.url));

// Core and server locate their default asset directories from import.meta.url, which CommonJS lacks; give the
// bundle its own file URL instead. embedded.ts passes explicit dist/ paths for those assets anyway.
const IMPORT_META_SHIM = "const __mmImportMetaUrl = require('node:url').pathToFileURL(__filename).href;";

await build({
  absWorkingDir: here,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  define: { 'import.meta.url': '__mmImportMetaUrl' },
  banner: { js: IMPORT_META_SHIM },
  sourcemap: true,
  logLevel: 'warning',
});

// The tree-sitter runtime and grammars are WebAssembly read when the backend starts, so they ship beside the bundle.
copyGrammarAssets(`${here}dist`);

// A packaged .vsix also carries the web UI for "Open Studio in Browser"; build it first (npm run build -w @mindmeld/web).
if (process.argv.includes('--package')) {
  if (!existsSync(webDist)) throw new Error(`web UI not built: ${webDist} is missing (run npm run build -w @mindmeld/web)`);
  cpSync(webDist, `${here}dist/web`, { recursive: true });
}
