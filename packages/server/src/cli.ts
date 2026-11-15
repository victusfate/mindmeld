#!/usr/bin/env node
// The `mindmeld` command (USAGE in cli-args.ts). Starts the localhost backend, imports each PATH (reusing an earlier
// import of the same repo), and opens the browser UI on the last one. Without --port, a busy default port falls
// back to a free one. `mindmeld mcp` instead serves one project's index to an agent over stdio (stdout is the
// protocol, so it logs to stderr).
import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EvidenceStore, formatUsage, summarizeUsage, type Studio } from '@mindmeld/core';
import { dataDirFrom, launch, openStudio, packageVersion } from './bootstrap.ts';
import { shortHash } from './format.ts';
import { McpServer } from './mcp/protocol.ts';
import { ProjectTools } from './mcp/tools.ts';
import { CliUsageError, findLocalProject, openCommand, parseCli, USAGE, type CliArgs } from './cli-args.ts';

const EXIT_USAGE = 2;

function fail(message: string): never {
  console.error(`mindmeld: ${message}\n${USAGE}`);
  process.exit(EXIT_USAGE);
}

function args(): CliArgs {
  try { return parseCli(process.argv.slice(2)); } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    return fail(error.message);
  }
}

/** Real paths of the PATH arguments, checked before anything starts so a typo fails fast. */
function repoRoots(refs: string[]): string[] {
  return refs.map(ref => {
    try { if (statSync(ref).isDirectory()) return realpathSync(ref); } catch { /* reported below */ }
    return fail(`not a directory: ${ref}`);
  });
}

function printUsage(a: CliArgs): void {
  const store = new EvidenceStore(join(dataDirFrom(process.env, a.data), 'evidence.db'));
  const records = store.usage();
  console.log(a.json ? records.map(r => JSON.stringify(r)).join('\n') : formatUsage(summarizeUsage(records)));
  store.close();
}

async function importRoot(studio: Studio, root: string, include: string[] | undefined, log: (text: string) => void): Promise<string> {
  const known = findLocalProject(studio.store.listProjects(), root, include);
  const { project, snapshot } = known
    ? { project: known, snapshot: studio.refresh(known.id) }
    : await studio.addProject({ kind: 'local', ref: root, include });
  log(`${known ? 'refreshed' : 'imported'} ${project.name} (${snapshot.files.length} files, snapshot ${shortHash(snapshot.snapshotHash)})`);
  return project.id;
}

function openBrowser(url: string): void {
  const [command, argv] = openCommand(url, process.platform, process.env);
  const child = spawn(command, argv, { detached: true, stdio: 'ignore' });
  child.on('error', () => { console.log('note: could not open a browser; open the URL above'); });
  child.unref();
}

async function serveMcp(a: CliArgs, root: string): Promise<void> {
  console.log = console.error;   // stdout is the protocol stream: nothing else may write to it
  const { studio, notes } = await openStudio({ dataDir: a.data });
  for (const note of notes) console.error(`note: ${note}`);
  const projectId = await importRoot(studio, root, a.include, text => console.error(text));
  await new McpServer({ name: 'mindmeld', version: packageVersion() }, new ProjectTools(studio, projectId).list()).serve(process.stdin, process.stdout);
  studio.store.close();
}

async function exportExplorer(a: CliArgs, root: string): Promise<void> {
  const { studio, notes } = await openStudio({ dataDir: a.data });
  for (const note of notes) console.log(`note: ${note}`);
  const projectId = await importRoot(studio, root, a.include, text => console.log(text));
  // Loaded on demand: the renderer lives in the checkout's scripts/, which the container image does not ship.
  const { writeExplorer } = await import('./explorer-files.ts').catch(() => fail('explorer needs a source checkout (scripts/explorer-render.ts)'));
  for (const path of writeExplorer(studio.graph(projectId), a.out ?? '.')) console.log(`wrote ${path}`);
  studio.store.close();
}

const a = args();
if (a.help) { console.log(USAGE); process.exit(0); }
if (a.usage) { printUsage(a); process.exit(0); }
const roots = repoRoots(a.projects);
if (a.command === 'mcp') { await serveMcp(a, roots[0]); process.exit(0); }
if (a.command === 'explorer') { await exportExplorer(a, roots[0]); process.exit(0); }
const { studio, running, notes } = await launch({ port: a.port, host: a.host, dataDir: a.data, portFallback: true });
let last: string | null = null;
for (const root of roots) last = await importRoot(studio, root, a.include, text => console.log(text));
const status = await studio.status();
for (const note of notes) console.log(`note: ${note}`);
console.log(`sandbox: ${status.sandbox.available ? 'available' : 'UNAVAILABLE'} — ${status.sandbox.reason}`);
console.log(`model:   ${status.model.available ? 'available' : 'unavailable'} — ${status.model.reason}`);
const url = `${running.url}/auth?token=${running.token}${last ? `&project=${encodeURIComponent(last)}` : ''}`;
console.log(`Mind Meld Studio: ${url}`);
if (a.open && process.stdout.isTTY) openBrowser(url);
const stop = (): void => { void running.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
