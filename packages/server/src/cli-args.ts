// Pure pieces of the `mindmeld` command: argument parsing with a readable error, the command that opens a URL in
// the user's browser on each platform, and finding a repo that was already imported so a second launch reuses it.
import { parseArgs } from 'node:util';
import type { Project } from '@mindmeld/core';

export const USAGE = `usage: mindmeld [PATH…] [--include DIR]… [--port N] [--host H] [--data DIR] [--no-open]
       mindmeld mcp [PATH] [--include DIR]… [--data DIR]   MCP server on stdio for agents (PATH defaults to .)
       mindmeld --usage [--json] [--data DIR]`;

export interface CliArgs {
  /** `serve` starts the browser backend; `mcp` serves one project to an agent over stdio. */
  command: 'serve' | 'mcp';
  projects: string[];
  include?: string[];
  port?: number;
  host?: string;
  data?: string;
  open: boolean;
  usage: boolean;
  json: boolean;
  help: boolean;
}

export class CliUsageError extends Error {}

const OPTIONS = {
  port: { type: 'string' },
  host: { type: 'string' },
  data: { type: 'string' },
  project: { type: 'string', multiple: true },
  include: { type: 'string', multiple: true },
  open: { type: 'boolean', default: true },
  usage: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

/** `mindmeld mcp [PATH]` takes one project, defaulting to the current directory. */
function commandOf(positionals: string[], aliases: string[]): Pick<CliArgs, 'command' | 'projects'> {
  if (positionals[0] !== 'mcp') return { command: 'serve', projects: [...positionals, ...aliases] };
  const projects = [...positionals.slice(1), ...aliases];
  if (projects.length > 1) throw new CliUsageError('mcp serves one project; pass at most one PATH');
  return { command: 'mcp', projects: projects.length ? projects : ['.'] };
}

/** `--project PATH` is kept as an alias for a positional PATH. */
export function parseCli(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, allowNegative: true, options: OPTIONS });
  } catch (error) { throw new CliUsageError(error instanceof Error ? error.message : String(error)); }
  const { values: v, positionals } = parsed;
  const port = v.port === undefined ? undefined : Number(v.port);
  if (port !== undefined && !Number.isInteger(port)) throw new CliUsageError(`--port must be a number, got ${v.port}`);
  return {
    ...commandOf(positionals, v.project ?? []), include: v.include?.length ? v.include : undefined,
    port, host: v.host, data: v.data, open: v.open, usage: v.usage, json: v.json, help: v.help,
  };
}

/** The program and arguments that open `url` in the default browser; WSL hands it to Windows. */
export function openCommand(url: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]];
  if (env.WSL_DISTRO_NAME) return ['explorer.exe', [url]];
  return ['xdg-open', [url]];
}

/** `src/` and `src` name the same directory; order does not matter. */
const scopeKey = (include: readonly string[] | undefined): string =>
  JSON.stringify((include ?? []).map(dir => dir.replace(/\/+$/, '')).sort());

/** A local project already imported from `root` with the same include scope. */
export const findLocalProject = (projects: readonly Project[], root: string, include: readonly string[] | undefined): Project | undefined =>
  projects.find(p => p.sourceKind === 'local' && p.root === root && scopeKey(p.include) === scopeKey(include));
