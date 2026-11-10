#!/usr/bin/env node
// mindmeld-studio [--port N] [--host H] [--data DIR] [--project PATH]
// mindmeld-studio --usage [--json] [--data DIR]   prints recorded usage (to share back) and exits
// Starts the localhost backend and prints the one-time login URL. The CLI is an implementation
// interface; the product is the desktop app, the browser UI and the VS Code extension.
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, formatUsage, summarizeUsage } from '@mindmeld/core';
import { launch } from './bootstrap.ts';

const HASH_PREFIX = 12;
const { values } = parseArgs({ options: { port: { type: 'string' }, host: { type: 'string' }, data: { type: 'string' }, project: { type: 'string', multiple: true }, usage: { type: 'boolean' }, json: { type: 'boolean' } } });
if (values.usage) {
  const store = new EvidenceStore(join(values.data ?? process.env.MINDMELD_DATA_DIR ?? join(homedir(), '.mindmeld'), 'evidence.db'));
  const records = store.usage();
  console.log(values.json ? records.map(r => JSON.stringify(r)).join('\n') : formatUsage(summarizeUsage(records)));
  store.close();
  process.exit(0);
}
const { studio, running, notes } = await launch({ port: values.port ? Number(values.port) : undefined, host: values.host, dataDir: values.data });
for (const ref of values.project ?? []) {
  const { project, snapshot } = await studio.addProject({ kind: 'local', ref });
  console.log(`imported ${project.name} (${snapshot.files.length} files, snapshot ${snapshot.snapshotHash.slice(0, HASH_PREFIX)})`);
}
const status = await studio.status();
for (const note of notes) console.log(`note: ${note}`);
console.log(`sandbox: ${status.sandbox.available ? 'available' : 'UNAVAILABLE'} — ${status.sandbox.reason}`);
console.log(`model:   ${status.model.available ? 'available' : 'unavailable'} — ${status.model.reason}`);
console.log(`Mind Meld Studio: ${running.url}/auth?token=${running.token}`);
const stop = (): void => { void running.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
