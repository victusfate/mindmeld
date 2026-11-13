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
  assert.equal(edge(idx, 'tools/pipeline.py#Stage.run', 'tools/pipeline.py#A.render'), undefined, 'unknown receivers are never guessed');
  assert.ok(idx.imports.some(i => i.from === 'tools/pipeline.py' && i.to === 'tools/util.py'));
  assert.ok(idx.edges.every(e => e.provenance === 'static' && e.kind === 'call'));
});

test('a name with more candidates than the bound produces no name-match edge', () => {
  const files = Object.fromEntries(['a', 'b', 'c', 'd'].map(m => [`src/${m}.rs`, 'pub fn helper() {}\n']));
  const idx = index({ ...files, 'src/main.rs': 'fn main() { helper(); }\n' });
  assert.equal(idx.edges.filter(e => e.from === 'src/main.rs#main').length, 0);
  const few = index({ 'src/a.rs': 'pub fn helper() {}\n', 'src/main.rs': 'fn main() { helper(); }\n' });
  assert.equal(edge(few, 'src/main.rs#main', 'src/a.rs#helper'), 'name-match');
});

test('python and gdscript bare calls to unknown names are builtins or engine methods, not name matches', () => {
  const idx = index({
    'a.py': 'def quit():\n    pass\n',
    'b.py': 'def main():\n    quit()\n',
    'tools/a.gd': 'func quit():\n\tpass\n',
    'tools/b.gd': 'extends SceneTree\nfunc _init():\n\tquit()\n\tget_tree().quit()\n',
  });
  assert.deepEqual(idx.edges.filter(e => e.from === 'b.py#main' || e.from === 'tools/b.gd#_init'), []);
});

test('syntax errors keep the symbols that parsed and never throw', () => {
  const idx = index({ 'broken.py': 'def ok():\n    pass\n\ndef broken(:\n' });
  assert.ok(symbol(idx, 'broken.py#ok'));
});

test('rust: free functions, impl and trait methods, types, visibility, async and call resolution', () => {
  const idx = index({
    'sim/src/combat.rs': [
      'pub struct Ship { hp: i32 }',
      'enum Mode { Idle }',
      'pub trait Damage { fn apply(&self, n: i32); }',
      '',
      'impl Ship {',
      '    pub fn new(hp: i32) -> Self { Ship { hp } }',
      '    pub async fn tick(&mut self, dt: f32) {',
      '        self.repair();',
      '        clamp(1);',
      '        helpers::scale(2);',
      '        Ship::new(3);',
      '        println!("macro is not a call");',
      '    }',
      '    fn repair(&mut self) {}',
      '}',
      '',
      'impl Damage for Ship { fn apply(&self, n: i32) { let _ = n; } }',
      '',
      'fn clamp(x: i32) -> i32 { x }',
    ].join('\n'),
    'sim/src/helpers.rs': 'pub fn scale(k: i32) -> i32 { k }\n',
  });
  assert.equal(symbol(idx, 'sim/src/combat.rs#Ship')?.kind, 'class');
  assert.equal(symbol(idx, 'sim/src/combat.rs#Mode')?.exported, false);
  assert.equal(symbol(idx, 'sim/src/combat.rs#Damage')?.kind, 'class');
  const tick = symbol(idx, 'sim/src/combat.rs#Ship.tick')!;
  assert.deepEqual([tick.kind, tick.async, tick.exported, tick.params, tick.span.startLine], ['method', true, true, ['self', 'dt'], 7]);
  assert.equal(symbol(idx, 'sim/src/combat.rs#Ship.repair')?.exported, false);
  assert.equal(symbol(idx, 'sim/src/combat.rs#Ship.apply')?.kind, 'method');
  assert.equal(symbol(idx, 'sim/src/combat.rs#clamp')?.kind, 'function');
  assert.equal(edge(idx, 'sim/src/combat.rs#Ship.tick', 'sim/src/combat.rs#Ship.repair'), 'this-member');
  assert.equal(edge(idx, 'sim/src/combat.rs#Ship.tick', 'sim/src/combat.rs#clamp'), 'local');
  assert.equal(edge(idx, 'sim/src/combat.rs#Ship.tick', 'sim/src/helpers.rs#scale'), 'name-match');
  assert.equal(edge(idx, 'sim/src/combat.rs#Ship.tick', 'sim/src/combat.rs#Ship.new'), 'name-match');
  assert.equal(idx.edges.filter(e => e.from === 'sim/src/combat.rs#Ship.tick').length, 4);
});

test('gdscript: script functions, inner classes, implicit self and class-qualified calls', () => {
  const idx = index({
    'godot/player.gd': [
      'class_name Player',
      'extends Node',
      '',
      'static func make(a: int, b := 2) -> Player:',
      '\treturn Player.new()',
      '',
      'func _ready():',
      '\tself.heal(1)',
      '\theal(2)',
      '\tvar x = Helper.compute(3)',
      '',
      'func heal(n):',
      '\tpass',
      '',
      'class Inner:',
      '\tfunc go(speed):',
      '\t\tself.stop()',
      '\t\tstop()',
      '\tfunc stop():',
      '\t\tpass',
    ].join('\n'),
    'godot/helper.gd': 'class_name Helper\n\nstatic func compute(v):\n\treturn v\n',
  });
  const ready = symbol(idx, 'godot/player.gd#_ready')!;
  assert.deepEqual([ready.kind, ready.exported, ready.async, ready.span.startLine, ready.span.endLine], ['function', false, false, 7, 10]);
  assert.deepEqual(symbol(idx, 'godot/player.gd#make')?.params, ['a', 'b']);
  assert.equal(symbol(idx, 'godot/player.gd#Inner')?.kind, 'class');
  assert.equal(symbol(idx, 'godot/player.gd#Inner.go')?.kind, 'method');
  assert.equal(edge(idx, 'godot/player.gd#_ready', 'godot/player.gd#heal'), 'this-member');
  assert.equal(idx.edges.filter(e => e.from === 'godot/player.gd#_ready' && e.to === 'godot/player.gd#heal').map(e => e.resolution).sort().join(), 'local,this-member');
  assert.equal(edge(idx, 'godot/player.gd#_ready', 'godot/helper.gd#compute'), 'import', 'class_name is a global binding');
  assert.deepEqual(idx.edges.filter(e => e.from === 'godot/player.gd#Inner.go').map(e => [e.to, e.resolution]),
    [['godot/player.gd#Inner.stop', 'this-member'], ['godot/player.gd#Inner.stop', 'local']]);
});

test('one symbol id declared twice (two trait impls) yields one symbol and one edge per call', () => {
  const idx = index({ 'x.rs': 'struct X;\nimpl A for X { fn f(&self) {} }\nimpl B for X { fn f(&self) {} }\nfn main() { X::f(); }\n' });
  assert.equal(idx.symbols.filter(s => s.id === 'x.rs#X.f').length, 1);
  assert.equal(idx.edges.filter(e => e.from === 'x.rs#main').length, 1);
});
