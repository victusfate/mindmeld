// The in-sandbox harness, emitted as plain JavaScript beside the instrumented sources. It imports the
// allowlisted entry, calls it with the user's JSON inputs and prints one marked JSON trace line.
// It runs inside the untrusted process, so the host re-validates and re-redacts everything it prints.
import { SECRET_KEY_PATTERN } from './redact.ts';

export const HARNESS_FILE = 'mindmeld-harness.mjs';

export const HARNESS_SOURCE = String.raw`
import { AsyncLocalStorage } from 'node:async_hooks';
const [entryFile, exportName, inputsB64, marker, maxEventsText] = process.argv.slice(2);
const MAX_EVENTS = Number(maxEventsText) || 5000;
const MAX_STRING = 400;
const MAX_ITEMS = 30;
const MAX_DEPTH = 4;
const MAX_SERIALIZED = 4000;
const SECRET_KEY = new RegExp('${SECRET_KEY_PATTERN}', 'i');
const als = new AsyncLocalStorage();
const events = [];
let truncated = false;
const t0 = performance.now();
function plain(value, depth, seen) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === undefined) return '(undefined)';
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  if (typeof value === 'bigint') return value.toString() + 'n';
  if (typeof value === 'function') return '(function ' + (value.name || 'anonymous') + ')';
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Error) return { error: value.name, message: String(value.message).slice(0, MAX_STRING) };
  if (seen.has(value)) return '(circular)';
  if (depth >= MAX_DEPTH) return '(depth limit)';
  seen.add(value);
  try {
    if (value instanceof Map) return { '(Map)': plain(Object.fromEntries([...value.entries()].slice(0, MAX_ITEMS)), depth + 1, seen) };
    if (value instanceof Set) return { '(Set)': plain([...value].slice(0, MAX_ITEMS), depth + 1, seen) };
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(v => plain(v, depth + 1, seen));
    if (typeof value.then === 'function') return '(promise)';
    const out = {};
    for (const key of Object.keys(value).slice(0, MAX_ITEMS)) out[key] = SECRET_KEY.test(key) ? '[REDACTED]' : plain(value[key], depth + 1, seen);
    return out;
  } finally { seen.delete(value); }
}
function serialize(value) {
  try { const text = JSON.stringify(plain(value, 0, new Set())); return text === undefined ? '(undefined)' : text.slice(0, MAX_SERIALIZED); }
  catch { return '(unserializable)'; }
}
function receiver(self) {
  if (self === undefined || self === null || typeof self !== 'object') return null;
  const fields = {};
  for (const key of Object.getOwnPropertyNames(self)) fields[key] = self[key];
  return serialize(fields);
}
globalThis.__mindmeld = {
  span(symbol, names, values, fn, self) {
    if (events.length >= MAX_EVENTS) { truncated = true; return fn(); }
    const parent = als.getStore() ?? null;
    const args = {};
    names.forEach((name, i) => { args[name] = values[i]; });
    const ev = { seq: events.length, symbol, parent, depth: parent === null ? 0 : events[parent].depth + 1,
      args: serialize(args), result: '', threw: false, async: false, thisBefore: receiver(self), thisAfter: null,
      startMs: performance.now() - t0, durationMs: 0 };
    events.push(ev);
    const finish = (v, threw) => {
      ev.result = serialize(v); ev.threw = threw; ev.durationMs = performance.now() - t0 - ev.startMs;
      const after = receiver(self);
      if (after === ev.thisBefore) { ev.thisBefore = null; } else { ev.thisAfter = after; }
    };
    let out;
    try { out = als.run(ev.seq, fn); } catch (error) { finish(error, true); throw error; }
    if (out && typeof out.then === 'function') {
      ev.async = true;
      return out.then(v => { finish(v, false); return v; }, e => { finish(e, true); throw e; });
    }
    finish(out, false);
    return out;
  },
};
let status = 'ok', output = '(undefined)', error = null;
try {
  const mod = await import(new URL('./' + entryFile, import.meta.url).href);
  const fn = mod[exportName];
  if (typeof fn !== 'function') throw new Error('entry is not an exported function: ' + exportName);
  const inputs = JSON.parse(Buffer.from(inputsB64, 'base64').toString('utf8'));
  output = serialize(await fn(...inputs));
} catch (e) { status = 'error'; error = serialize(e); }
process.stdout.write('\n' + marker + JSON.stringify({ status, output, error, events, truncated, runtime: process.version }) + '\n', () => process.exit(0));
`;
