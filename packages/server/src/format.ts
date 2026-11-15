// Text formatting shared by the CLI and the MCP tools.

const HASH_PREFIX = 12;

/** The first 12 hex characters: enough to tell snapshots and files apart in output. */
export const shortHash = (hash: string): string => hash.slice(0, HASH_PREFIX);
