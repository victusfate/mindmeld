// Bundles the Electron main process with esbuild. Electron's bundled Node cannot run the workspace's TypeScript
// sources directly, so @mindmeld/* and `typescript` (used by core's indexer) are bundled into dist/main.mjs.
// Only `electron` itself stays external. Run: node build.ts
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyGrammarAssets } from '../core/scripts/grammar-assets.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
/** Electron 44 ships Node 24 (node:sqlite needs ≥ 22.13). */
const NODE_TARGET = 'node24';

// The bundled `typescript` package is CommonJS: it calls require() for Node built-ins and reads __filename at load
// time. Give the ESM bundle those CommonJS globals.
const REQUIRE_SHIM = [
  "import { createRequire as __mmCreateRequire } from 'node:module';",
  "import { fileURLToPath as __mmFileURLToPath } from 'node:url';",
  "import { dirname as __mmDirname } from 'node:path';",
  'const require = __mmCreateRequire(import.meta.url);',
  'const __filename = __mmFileURLToPath(import.meta.url);',
  'const __dirname = __mmDirname(__filename);',
].join(' ');

// ESM (not CJS) because @mindmeld/server resolves its default web dir from import.meta.url: dist/../../web/dist
// is packages/web/dist, the same directory the server uses when run from source.
await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: NODE_TARGET,
  external: ['electron'],
  banner: { js: REQUIRE_SHIM },
  logLevel: 'warning',
});

// The tree-sitter runtime and grammars are WebAssembly files read at start-up, so they ship beside the bundle;
// main.ts passes these paths to launch().
copyGrammarAssets(`${root}dist`);
