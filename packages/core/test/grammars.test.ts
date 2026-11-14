import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GRAMMAR_DIR, loadGrammars } from '../src/index.ts';

const pinnedRuntime = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }).dependencies['web-tree-sitter'];

test('vendored grammars load, verify against the manifest and parse their language', async () => {
  const grammars = await loadGrammars();
  assert.equal(grammars.version, `web-tree-sitter/${pinnedRuntime} rust/0.24.0 python/0.25.0 gdscript/6.1.0`);
  const samples = { rust: 'fn tick() {}', python: 'def run():\n    pass\n', gdscript: 'func _ready():\n\tpass\n' } as const;
  for (const [language, source] of Object.entries(samples)) {
    const shape = grammars.withTree(language as keyof typeof samples, source, root => ({ error: root.hasError, children: root.namedChildCount }));
    assert.deepEqual(shape, { error: false, children: 1 }, language);
  }
});

test('a grammar file that does not match its manifest checksum is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-grammars-'));
  cpSync(GRAMMAR_DIR, dir, { recursive: true });
  writeFileSync(join(dir, 'tree-sitter-python.wasm'), 'tampered');
  await assert.rejects(loadGrammars({ dir }), /tree-sitter-python\.wasm.*checksum/);
});
