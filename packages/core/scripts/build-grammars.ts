// Regenerates the vendored tree-sitter grammars in ../grammars and their manifest.
//
// The grammar npm packages run native install scripts, so the runtime never installs them: this script fetches
// the pinned tarballs with `npm pack` (which runs no scripts), copies the prebuilt .wasm for Rust and Python, and
// builds GDScript's .wasm (its package ships none) with the pinned tree-sitter CLI. Run it only to change a pin:
//   node packages/core/scripts/build-grammars.ts
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/hash.ts';

const TREE_SITTER_CLI = 'tree-sitter-cli@0.27.2';
const HASH_PREFIX = 12;
const GRAMMARS = [
  { language: 'rust', pkg: 'tree-sitter-rust', version: '0.24.0', build: false },
  { language: 'python', pkg: 'tree-sitter-python', version: '0.25.0', build: false },
  { language: 'gdscript', pkg: 'tree-sitter-gdscript', version: '6.1.0', build: true },
] as const;

const outDir = new URL('../grammars/', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'mm-grammars-'));
const run = (cmd: string, args: string[], cwd = work): string => execFileSync(cmd, args, { cwd, encoding: 'utf8' });

function unpack(pkg: string, version: string): string {
  const tarball = run('npm', ['pack', `${pkg}@${version}`, '--silent']).trim();
  const dir = join(work, pkg);
  mkdirSync(dir);
  run('tar', ['-xzf', tarball, '-C', dir, '--strip-components=1']);
  return dir;
}

function treeSitterCli(): string {
  const prefix = join(work, 'cli');
  run('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--silent', TREE_SITTER_CLI]);
  const pkgDir = join(prefix, 'node_modules/tree-sitter-cli');
  run('node', ['install.js'], pkgDir);   // downloads the CLI binary for this platform
  return join(pkgDir, 'tree-sitter');
}

try {
  const cli = GRAMMARS.some(g => g.build) ? treeSitterCli() : '';
  const manifest = GRAMMARS.map(({ language, pkg, version, build }) => {
    const dir = unpack(pkg, version);
    const file = `${pkg}.wasm`;
    if (build) run(cli, ['build', '--wasm', '-o', join(outDir, file), '.'], dir);
    else copyFileSync(join(dir, file), join(outDir, file));
    const license = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { license: string }).license;
    copyFileSync(join(dir, 'LICENSE'), join(outDir, `${pkg}.LICENSE`));
    return { language, file, package: pkg, version, license, built: build ? TREE_SITTER_CLI : null, sha256: sha256(readFileSync(join(outDir, file))) };
  });
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifest.map(m => `${m.file} ${m.sha256.slice(0, HASH_PREFIX)}`).join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true });
}
