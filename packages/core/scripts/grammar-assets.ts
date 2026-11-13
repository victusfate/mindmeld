// Build-time helper for bundled apps (desktop, VS Code): copies the tree-sitter runtime and the vendored grammars
// beside a bundle, in the layout `bundledGrammarFiles()` reads at start-up.
import { cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BUNDLED_GRAMMAR_SUBDIR, BUNDLED_RUNTIME_WASM, GRAMMAR_DIR } from '../src/grammars.ts';

export function copyGrammarAssets(bundleDir: string): void {
  cpSync(GRAMMAR_DIR, join(bundleDir, BUNDLED_GRAMMAR_SUBDIR), { recursive: true });
  cpSync(createRequire(import.meta.url).resolve('web-tree-sitter/web-tree-sitter.wasm'), join(bundleDir, BUNDLED_RUNTIME_WASM));
}
