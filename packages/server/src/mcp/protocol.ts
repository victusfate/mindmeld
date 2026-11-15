// A minimal Model Context Protocol server over stdio: newline-delimited JSON-RPC 2.0 with the `tools` capability
// only (initialize, ping, tools/list, tools/call). Hand-rolled rather than pulling the SDK and its HTTP stack in;
// stdout carries protocol messages only, so callers log to stderr.
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/** Newest first; an initialize request naming one of these gets it back, anything else gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** Returns text for the agent; a thrown error becomes an `isError` result the agent can read and correct. */
  run(args: Record<string, unknown>): Promise<string> | string;
}

interface Request { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }
type Reply = { result: unknown } | { error: { code: number; message: string } };

const ERR = { parse: -32700, invalidRequest: -32600, notFound: -32601, invalidParams: -32602 } as const;

export class McpServer {
  private readonly info: { name: string; version: string };
  private readonly tools: Tool[];

  constructor(info: { name: string; version: string }, tools: Tool[]) { this.info = info; this.tools = tools; }

  private async callTool(params: Record<string, unknown> | undefined): Promise<Reply> {
    const tool = this.tools.find(t => t.name === params?.name);
    if (!tool) return { error: { code: ERR.invalidParams, message: `unknown tool ${String(params?.name)}` } };
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    try { return { result: { content: [{ type: 'text', text: await tool.run(args) }] } }; } catch (error) {
      return { result: { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true } };
    }
  }

  /** The reply to one request (a message with an id). */
  async handle(message: Request): Promise<Reply> {
    switch (message.method) {
      case 'initialize': {
        const asked = message.params?.protocolVersion;
        const protocolVersion = PROTOCOL_VERSIONS.find(v => v === asked) ?? PROTOCOL_VERSIONS[0];
        return { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: this.info } };
      }
      case 'ping': return { result: {} };
      case 'tools/list':
        return { result: { tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
      case 'tools/call': return this.callTool(message.params);
      default: return { error: { code: ERR.notFound, message: `method not found: ${message.method}` } };
    }
  }

  /** Serves until `input` ends, then returns once every reply is flushed. Requests are answered in order;
   * notifications (no id) are acknowledged by silence and never run a tool. */
  async serve(input: Readable, output: Writable): Promise<void> {
    const send = (msg: unknown): void => { output.write(`${JSON.stringify(msg)}\n`); };
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      let message: Request;
      try { message = JSON.parse(line) as Request; } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: ERR.parse, message: 'parse error' } });
        continue;
      }
      if (typeof message?.method !== 'string' || message.id === null) {   // MCP request ids are never null
        send({ jsonrpc: '2.0', id: null, error: { code: ERR.invalidRequest, message: 'invalid request' } });
        continue;
      }
      if (message.id === undefined) continue;
      send({ jsonrpc: '2.0', id: message.id, ...(await this.handle(message)) });
    }
    await new Promise<void>(resolve => { output.write('', () => resolve()); });
  }
}
