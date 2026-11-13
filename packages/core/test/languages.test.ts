import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { importRepository, indexSources, loadGrammars, type StaticIndex } from '../src/index.ts';

const grammars = await loadGrammars();

function index(files: Record<string, string>): StaticIndex {
  const dir = mkdtempSync(join(tmpdir(), 'mm-lang-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const repo = importRepository(dir);
  return indexSources(repo.files, repo.contents, grammars);
}

const symbol = (idx: StaticIndex, id: string) => idx.symbols.find(s => s.id === id);
const edge = (idx: StaticIndex, from: string, to: string) => idx.edges.find(e => e.from === from && e.to === to)?.resolution;

test('python: functions, classes, methods, imports and bounded name matches', () => {
  const idx = index({
    'tools/util.py': 'def clamp(x, lo=0, *rest, **kw):\n    return max(lo, x)\n\ndef _private():\n    pass\n',
    'tools/pipeline.py': [
      'from tools.util import clamp',
      'from . import util',
      '',
      'class Stage:',
      '    async def run(self, item):',
      '        self.prepare(item)',
      '        clamp(item)',
      '        util.clamp(item)',
      '        helper()',
      '        item.render()',
      '',
      '    def prepare(self, item):',
      '        def nested():',
      '            pass',
      '',
      'def helper():',
      '    pass',
      '',
      'def render_all(items):',
      '    for i in items:',
      '        i.render()',
      '',
      'class A:\n    def render(self):\n        pass\n',
      'class B:\n    def render(self):\n        pass\n',
    ].join('\n'),
  });
  assert.deepEqual(symbol(idx, 'tools/util.py#clamp')?.params, ['x', 'lo', 'rest', 'kw']);
  assert.equal(symbol(idx, 'tools/util.py#clamp')?.exported, true);
  assert.equal(symbol(idx, 'tools/util.py#_private')?.exported, false);
  const run = symbol(idx, 'tools/pipeline.py#Stage.run')!;
  assert.deepEqual([run.kind, run.async, run.span.startLine, run.span.endLine], ['method', true, 5, 10]);
  assert.equal(symbol(idx, 'tools/pipeline.py#Stage')?.kind, 'class');
  assert.equal(symbol(idx, 'tools/pipeline.py#nested'), undefined, 'nested functions are not symbols');
  assert.equal(edge(idx, 'tools/pipeline.py#Stage.run', 'tools/pipeline.py#Stage.prepare'), 'this-member');
  assert.equal(edge(idx, 'tools/pipeline.py#Stage.run', 'tools/util.py#clamp'), 'import');
  assert.equal(edge(idx, 'tools/pipeline.py#Stage.run', 'tools/pipeline.py#helper'), 'local');
  assert.equal(edge(idx, 'tools/pipeline.py#Stage.run', 'tools/pipeline.py#A.render'), 'name-match');
  assert.ok(idx.imports.some(i => i.from === 'tools/pipeline.py' && i.to === 'tools/util.py'));
  assert.ok(idx.edges.every(e => e.provenance === 'static' && e.kind === 'call'));
});

test('a common method name with more candidates than the bound produces no name-match edge', () => {
  const classes = ['A', 'B', 'C', 'D'].map(c => `class ${c}:\n    def get(self):\n        pass\n`).join('\n');
  const idx = index({ 'm.py': `${classes}\ndef use(x):\n    x.get()\n` });
  assert.equal(idx.edges.filter(e => e.from === 'm.py#use').length, 0);
});

test('syntax errors keep the symbols that parsed and never throw', () => {
  const idx = index({ 'broken.py': 'def ok():\n    pass\n\ndef broken(:\n' });
  assert.ok(symbol(idx, 'broken.py#ok'));
});
