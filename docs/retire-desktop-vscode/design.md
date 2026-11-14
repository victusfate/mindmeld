# Retire the desktop app and the VS Code extension

## Decision (2026-11-14)

- **D-owner-1:** the owner chose one form factor so the product moves faster: "I feel 1 form factor would help us
  progress faster"; after comparing the three interfaces: "do it. completely remove those interfaces update our docs
  and readme".
- Mind Meld Studio is the browser UI (`packages/web`) served by the localhost backend (`packages/server`).

## Why the browser

- The desktop app loaded the same React UI in an Electron window; it added a native menu and packaging, not an
  interface.
- The VS Code extension was a second interface (tree views, CodeLens, an answer webview) that partly duplicated the
  browser UI and had no map. Keeping it meant maintaining two UIs.
- The browser runs beside any editor, needs no per-OS packaging, and is where the large-repo work (QA-001/002 in
  `docs/multi-language-index/qa-report.md`) was done.

## What was removed

- `packages/desktop` and `packages/vscode`, with their tests, build scripts and dependencies (Electron,
  electron-builder, vsce).
- Code that existed only for them: `launchLocal` (server), `bundledGrammarFiles`, `copyGrammarAssets` and the
  `runtimeWasm` / `grammarFiles` options (core grammar loading).
- CI's xvfb install, ignore rules for installers and `.vsix` files, and the desktop/extension sections of the README
  and quickstart.

## What is lost, and the planned replacement

- Opening a symbol in the editor: planned as `vscode://file/<path>:<line>` links from the browser UI.
- In-editor evidence (CodeLens) and agent access from the IDE: planned as an MCP server started by the CLI, so any
  agent (Claude Code, Codex, Cursor, Copilot) can query the index.
