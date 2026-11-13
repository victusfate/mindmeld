// Tree-sitter grammars for the languages the TypeScript compiler cannot parse. The .wasm files are vendored in
// ../grammars (see scripts/build-grammars.ts) and verified against their manifest before use, because they are
// executable code shipped inside the app.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node } from 'web-tree-sitter';
import { sha256 } from './hash.ts';

/** Kept equal to core's package.json pin by grammars.test.ts; part of the indexer version. */
const RUNTIME = 'web-tree-sitter/0.27.2';

export type GrammarLanguage = 'rust' | 'python' | 'gdscript';
export const GRAMMAR_DIR = fileURLToPath(new URL('../grammars/', import.meta.url));

interface ManifestEntry { language: GrammarLanguage; file: string; version: string; sha256: string }

export interface Grammars {
  /** Identifies runtime and grammar versions; a change means existing snapshots must be re-indexed. */
  readonly version: string;
  /** Parses `source` and hands the root to `read`; the tree is freed afterwards, so `read` must not keep nodes. */
  withTree<T>(language: GrammarLanguage, source: string, read: (root: Node) => T): T;
}

let runtimeReady: Promise<void> | null = null;

/** `runtimeWasm` locates web-tree-sitter's own .wasm when the code is bundled away from node_modules. */
export async function loadGrammars(dir: string = GRAMMAR_DIR, runtimeWasm?: string): Promise<Grammars> {
  runtimeReady ??= Parser.init(runtimeWasm ? { locateFile: () => runtimeWasm } : undefined);
  await runtimeReady;
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestEntry[];
  const parsers = new Map<GrammarLanguage, Parser>();
  for (const entry of manifest) {
    const bytes = readFileSync(join(dir, entry.file));
    if (sha256(bytes) !== entry.sha256) throw new Error(`${entry.file} does not match its manifest checksum`);
    const parser = new Parser();
    parser.setLanguage(await Language.load(bytes));
    parsers.set(entry.language, parser);
  }
  return {
    version: [RUNTIME, ...manifest.map(e => `${e.language}/${e.version}`)].join(' '),
    withTree(language, source, read) {
      const tree = parsers.get(language)?.parse(source);
      if (!tree) throw new Error(`no grammar loaded for ${language}`);
      try { return read(tree.rootNode); } finally { tree.delete(); }
    },
  };
}
