// Menu actions that call the in-process Studio directly (no HTTP round trip, no token in the renderer).
import { clipboard, dialog, type BrowserWindow, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatUsage, type Studio } from '@mindmeld/core';
import { statusText, type MenuActions } from './menu.ts';
import { USAGE_EXPORT_NAME, usageJsonl } from './usage-export.ts';

/** Same ceiling the HTTP API applies to POST /api/bundles. */
const MAX_BUNDLE_BYTES = 60_000_000;
const COPY_BUTTON = 0;

async function pickOne(win: BrowserWindow, options: OpenDialogOptions): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function readBundle(path: string): unknown {
  if (statSync(path).size > MAX_BUNDLE_BYTES) throw new Error('bundle is larger than 60 MB');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function messageBox(win: BrowserWindow | null, options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

/** Runs a user-triggered action; failures surface in a dialog instead of an unhandled rejection. */
function guarded(title: string, work: () => Promise<void>): () => void {
  return () => {
    work().catch((error: unknown) => dialog.showErrorBox(title, error instanceof Error ? error.message : String(error)));
  };
}

/** Help → Usage: the shareable plain-text summary, with a Copy button that puts it on the clipboard. */
export async function showUsage(studio: Studio, win: BrowserWindow | null): Promise<string> {
  const text = formatUsage(studio.usage());
  const { response } = await messageBox(win, {
    type: 'info', title: 'Mind Meld usage', message: 'Mind Meld usage', detail: text,
    buttons: ['Copy', 'Close'], defaultId: COPY_BUTTON, cancelId: 1,
  });
  if (response === COPY_BUTTON) await clipboard.writeText(text);
  return text;
}

async function exportUsage(studio: Studio, win: BrowserWindow | null, downloads: string): Promise<void> {
  const options = { title: 'Export Usage', defaultPath: join(downloads, USAGE_EXPORT_NAME), filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }] };
  const result = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
  if (result.canceled || !result.filePath) return;
  writeFileSync(result.filePath, usageJsonl(studio.usageRecords()), { mode: 0o600 });
}

export function menuActions(studio: Studio, window: () => BrowserWindow | null, downloads: string): MenuActions {
  return {
    openFolder: guarded('Open Folder failed', async () => {
      const win = window();
      const ref = win ? await pickOne(win, { title: 'Open Folder', properties: ['openDirectory'] }) : null;
      if (!win || !ref) return;
      await studio.addProject({ kind: 'local', ref });
      win.webContents.reload();
    }),
    importBundle: guarded('Import Bundle failed', async () => {
      const win = window();
      const filters = [{ name: 'Evidence bundle', extensions: ['json'] }];
      const path = win ? await pickOne(win, { title: 'Import Bundle', properties: ['openFile'], filters }) : null;
      if (!win || !path) return;
      studio.importBundle(readBundle(path));
      win.webContents.reload();
    }),
    exportUsage: guarded('Export Usage failed', () => exportUsage(studio, window(), downloads)),
    showStatus: guarded('Status unavailable', async () => {
      const detail = statusText(await studio.status());
      await messageBox(window(), { type: 'info', title: 'Mind Meld Studio status', message: 'Mind Meld Studio', detail });
    }),
    showUsage: guarded('Usage unavailable', async () => { await showUsage(studio, window()); }),
  };
}
