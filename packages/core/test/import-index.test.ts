import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importRepository, indexSources, resolveSpecifier, isSafeRelativePath } from '../src/index.ts';
import { FIXTURE } from './helpers.ts';

test('import skips symlinks, ignored dirs, binaries and oversize files; hashes are stable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-import-'));
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'node_modules/x'), { recursive: true }); mkdirSync(join(dir, 'gen'));
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'node_modules/x/index.js'), 'evil');
  writeFileSync(join(dir, 'gen/out.ts'), 'generated');
  writeFileSync(join(dir, '.gitignore'), 'gen/\n*.log\n');
  writeFileSync(join(dir, 'src/bin.ts'), Buffer.from([0x61, 0, 0x62]));
  writeFileSync(join(dir, 'src/big.ts'), 'x'.repeat(2000));
  symlinkSync('/etc/passwd', join(dir, 'src/escape.ts'));
  symlinkSync('/etc', join(dir, 'src/etcdir'));
  const repo = importRepository(dir, { maxFiles: 10, maxFileBytes: 1000, maxTotalBytes: 10_000, maxDepth: 5 });
  assert.deepEqual(repo.files.map(f => f.path), ['src/a.ts']);
  const reasons = Object.fromEntries(repo.skipped.map(s => [s.path, s.reason]));
  assert.equal(reasons['src/escape.ts'], 'symlink not followed');
  assert.equal(reasons['src/etcdir'], 'symlink not followed');
  assert.equal(reasons['src/bin.ts'], 'binary content');
  assert.equal(reasons['src/big.ts'], 'file too large');
  assert.equal(importRepository(dir).snapshotHash, importRepository(dir).snapshotHash);
});

test('path safety and specifier resolution never escape the file set', () => {
  assert.equal(isSafeRelativePath('../x'), false);
  assert.equal(isSafeRelativePath('/etc/passwd'), false);
  assert.equal(isSafeRelativePath('a/./b'), false);
  assert.equal(isSafeRelativePath('src/a.ts'), true);
  const files = new Set(['src/a.ts', 'src/lib/index.ts']);
  assert.equal(resolveSpecifier('src/b.ts', './a.js', files), 'src/a.ts');
  assert.equal(resolveSpecifier('src/b.ts', './lib', files), 'src/lib/index.ts');
  assert.equal(resolveSpecifier('src/b.ts', '../../../etc/passwd', files), null);
  assert.equal(resolveSpecifier('src/b.ts', 'lodash', files), null);
});

test('fixture index: exact spans and possible (static) call edges with provenance', () => {
  const repo = importRepository(FIXTURE);
  const idx = indexSources(repo.files, repo.contents);
  const ids = idx.symbols.map(s => s.id);
  for (const id of ['src/game.ts#playTurn', 'src/combat.ts#attack', 'src/combat.ts#legacyCritical', 'src/save.ts#MemorySave.write', 'src/damage.ts#clampHp']) assert.ok(ids.includes(id), id);
  const play = idx.symbols.find(s => s.id === 'src/game.ts#playTurn')!;
  assert.deepEqual([play.span.startLine, play.span.endLine], [10, 15]);
  assert.deepEqual(play.params, ['attacker', 'defender']);
  const edge = (from: string, to: string) => idx.edges.find(e => e.from === from && e.to === to);
  assert.equal(edge('src/combat.ts#attack', 'src/combat.ts#legacyCritical')?.resolution, 'local');
  assert.equal(edge('src/game.ts#playTurn', 'src/combat.ts#attack')?.resolution, 'import');
  assert.equal(edge('src/game.ts#playTurn', 'src/save.ts#MemorySave.write')?.resolution, 'name-match');
  assert.ok(idx.edges.every(e => e.provenance === 'static'));
  assert.deepEqual(idx.imports.find(i => i.from === 'src/game.ts' && i.to === 'src/combat.ts')?.names, ['attack']);
});

test('import admits code files before data files when the budget is short', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-tiers-'));
  mkdirSync(join(dir, 'a-data')); mkdirSync(join(dir, 'z-code'));
  for (const n of [1, 2, 3]) writeFileSync(join(dir, `a-data/${n}.json`), '{}');
  writeFileSync(join(dir, 'z-code/sim.rs'), 'fn tick() {}\n');
  writeFileSync(join(dir, 'z-code/tool.py'), 'def run():\n    pass\n');
  writeFileSync(join(dir, 'z-code/player.gd'), 'func _ready():\n\tpass\n');
  writeFileSync(join(dir, 'z-code/app.ts'), 'export const a = 1;\n');
  const repo = importRepository(dir, { maxFiles: 5, maxFileBytes: 1000, maxTotalBytes: 10_000, maxDepth: 5 });
  assert.deepEqual(repo.files.map(f => [f.path, f.language]), [
    ['z-code/app.ts', 'typescript'], ['z-code/player.gd', 'gdscript'], ['z-code/sim.rs', 'rust'], ['z-code/tool.py', 'python'],
    ['a-data/1.json', 'json'],
  ]);
  assert.deepEqual(repo.skipped.map(s => [s.path, s.reason]), [['a-data/2.json', 'file limit reached'], ['a-data/3.json', 'file limit reached']]);
});
