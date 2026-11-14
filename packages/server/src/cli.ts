#!/usr/bin/env node
// The `mindmeld` command (USAGE in cli-args.ts). Starts the localhost backend, imports each PATH (reusing an earlier
// import of the same repo), and opens the browser UI on the last one. Without --port, a busy default port falls
// back to a free one.
import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EvidenceStore, formatUsage, summarizeUsage, type Studio } from '@mindmeld/core';
import { dataDirFrom, launch } from './bootstrap.ts';
import { CliUsageError, findLocalProject, openCommand, parseCli, USAGE, type CliArgs } from './cli-args.ts';

const HASH_PREFIX = 12;
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

async function importRoot(studio: Studio, root: string, include: string[] | undefined): Promise<string> {
  const known = findLocalProject(studio.store.listProjects(), root, include);
  const { project, snapshot } = known
    ? { project: known, snapshot: studio.refresh(known.id) }
    : await studio.addProject({ kind: 'local', ref: root, include });
  console.log(`${known ? 'refreshed' : 'imported'} ${project.name} (${snapshot.files.length} files, snapshot ${snapshot.snapshotHash.slice(0, HASH_PREFIX)})`);
  return project.id;
}

function openBrowser(url: string): void {
  const [command, argv] = openCommand(url, process.platform, process.env);
  const child = spawn(command, argv, { detached: true, stdio: 'ignore' });
  child.on('error', () => { console.log('note: could not open a browser; open the URL above'); });
  child.unref();
}

const a = args();
if (a.help) { console.log(USAGE); process.exit(0); }
if (a.usage) { printUsage(a); process.exit(0); }
const roots = repoRoots(a.projects);
const { studio, running, notes } = await launch({ port: a.port, host: a.host, dataDir: a.data, portFallback: true });
let last: string | null = null;
for (const root of roots) last = await importRoot(studio, root, a.include);
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
