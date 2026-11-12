// Bundles the browser UI with esbuild into dist/: index.html plus hashed assets. Everything ships locally
// because the server's CSP allows only same-origin scripts, styles and fonts (no inline script, no CDN).
import { build as esbuild } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const DIST = join(HERE, 'dist');

function page(script: string, style: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="Mind Meld Studio: a source-linked architecture map with sandboxed runs, replay and cited answers.">
<title>Mind Meld Studio</title>
<link rel="stylesheet" href="/${style}">
<script type="module" src="/${script}"></script>
</head>
<body>
<div id="root"></div>
<noscript>Mind Meld Studio needs JavaScript.</noscript>
</body>
</html>
`;
}

export async function build(outDir = DIST): Promise<string> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const result = await esbuild({
    entryPoints: [join(HERE, 'src/main.tsx')],
    bundle: true, format: 'esm', target: 'es2023', minify: true, metafile: true, legalComments: 'linked',
    outdir: outDir, entryNames: 'assets/[name]-[hash]', assetNames: 'assets/[name]-[hash]',
    loader: { '.woff2': 'file', '.woff': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' },
    jsx: 'automatic', logLevel: 'warning',
  });
  const outputs = Object.keys(result.metafile.outputs).map(p => relative(outDir, p));
  const script = outputs.find(p => p.endsWith('.js') && basename(p).startsWith('main-'));
  const style = outputs.find(p => p.endsWith('.css') && basename(p).startsWith('main-'));
  if (!script || !style) throw new Error(`build produced no main bundle: ${outputs.join(', ')}`);
  writeFileSync(join(outDir, 'index.html'), page(script, style));
  return outDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await build();
  console.log(`built ${out}`);
}
