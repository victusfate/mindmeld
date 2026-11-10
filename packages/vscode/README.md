# Mind Meld Studio for VS Code

Shows Mind Meld Studio evidence next to your code. The extension only talks to a running Studio server; it never
runs repository code itself.

- **Static** edges are *possible* calls found by the indexer. **Observed** calls come only from recorded runs in
  the Studio sandbox. Runs whose source changed since are marked **STALE**.
- CodeLens per symbol, Symbols and Runs views (a run expands into its recorded call tree), questions answered
  through the server's local agent CLI with clickable citations, and a usage report you can copy or export.

## Use

1. Start the server: `node packages/server/src/cli.ts --port 8787 --project <path>`. It prints a login URL.
2. Run **Mind Meld: Connect** and paste that URL. The token is kept in VS Code secret storage.
3. Run **Mind Meld: Import Current Workspace**, then **Allowlist Function at Cursor** and **Run Entry**.

The sandbox and the model are optional; the status bar shows why either is unavailable.
