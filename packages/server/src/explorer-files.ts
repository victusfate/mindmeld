// Writes the explorer page for a project: the spec (`<slug>.explorer.json`, the source an agent can enrich and
// re-render with scripts/explorer-render.ts) and the self-contained page (`<slug>.explorer.html`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Graph } from '@mindmeld/core';
import { renderHtml } from '../../../scripts/explorer-render.ts';
import { validateSpec } from '../../../scripts/explorer-spec.ts';
import { explorerSpec } from './explorer.ts';

const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

/** Returns the written paths. A spec that fails the renderer's own validation is a bug here, so it throws. */
export function writeExplorer(graph: Graph, outDir: string): string[] {
  const spec = explorerSpec(graph);
  const problems = validateSpec(spec);
  if (problems.length) throw new Error(`generated explorer spec is invalid:\n  ${problems.join('\n  ')}`);
  mkdirSync(outDir, { recursive: true });
  const stem = join(outDir, `${slugOf(graph.project.name)}.explorer`);
  writeFileSync(`${stem}.json`, `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(`${stem}.html`, renderHtml(spec));
  return [`${stem}.json`, `${stem}.html`];
}
