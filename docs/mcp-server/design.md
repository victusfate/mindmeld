# MCP server: the index as agent tools

Replaces the retired extension's agent access (see [`../retire-desktop-vscode/design.md`](../retire-desktop-vscode/design.md));
one server reaches every MCP client (Claude Code, Codex, Cursor, Copilot) instead of one editor's API.

## Decisions
- **D1 — transport:** `mindmeld mcp [PATH]` speaks MCP over stdio, started by the agent. No HTTP, no token.
- **D2 — no SDK:** the protocol surface used (initialize, ping, tools/list, tools/call; newline-delimited JSON-RPC)
  is ~70 lines (`packages/server/src/mcp/protocol.ts`). The official SDK would add its HTTP transport stack and
  schema library as dependencies for that. Versions offered: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05.
- **D3 — one project per server:** PATH (default `.`) is imported or refreshed with the browser's reuse rule, in the
  same data dir (SQLite WAL), so the agent and the browser see the same evidence.
- **D4 — tools are deterministic and read the index:** `overview`, `find_symbols`, `symbol`, `file_symbols`, and
  `refresh` (the only write). No `ask`: the agent is the model; it gets evidence, with each static edge's resolution
  so it can discount `name-match`. Runs stay in the browser (they need the allowlist and sandbox).
- **D5 — output is plain text**, compact and line-oriented, with symbol ids the other tools accept. Errors are
  `isError` results naming the fix ("use find_symbols").
- **D6 — stdout is protocol only;** import progress and notes go to stderr. The server exits when stdin ends.

## Evidence
- `packages/server/test/mcp.test.ts`: protocol (negotiation, notifications, errors), tools on the combat-game
  fixture, and the CLI over stdio (two replies on stdout, progress on stderr, exit 0 on stdin end).
- Live: `claude -p` with `--mcp-config` pointing at `mindmeld mcp fixtures/combat-game` answered "Only
  `src/game.ts#playTurn` calls `attack` (src/game.ts:12), resolved by import" using only these tools.
