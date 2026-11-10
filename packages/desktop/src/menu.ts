// Application menu template. Kept free of Electron runtime imports so its shape is unit-tested.
import type { MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
  openFolder(): void;
  importBundle(): void;
  exportUsage(): void;
  showStatus(): void;
  showUsage(): void;
}

/** Stable menu item ids, so tests (and future code) can find items without matching labels. */
export const MENU_IDS = {
  openFolder: 'file-open-folder',
  importBundle: 'file-import-bundle',
  exportUsage: 'file-export-usage',
  status: 'help-status',
  usage: 'help-usage',
} as const;

export function menuTemplate(actions: MenuActions, opts: { dev: boolean; mac: boolean }): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions[] = [{ role: 'reload' }];
  if (opts.dev) view.push({ type: 'separator' }, { role: 'toggleDevTools' });
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { id: MENU_IDS.openFolder, label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => actions.openFolder() },
        { id: MENU_IDS.importBundle, label: 'Import Bundle…', click: () => actions.importBundle() },
        { id: MENU_IDS.exportUsage, label: 'Export Usage (JSONL)…', click: () => actions.exportUsage() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: view },
    {
      label: 'Help',
      submenu: [
        { id: MENU_IDS.status, label: 'Status…', click: () => actions.showStatus() },
        { id: MENU_IDS.usage, label: 'Usage…', click: () => actions.showUsage() },
      ],
    },
  ];
  return opts.mac ? [{ role: 'appMenu' }, ...template] : template;
}

export interface StatusLike {
  sandbox: { name: string; available: boolean; reason: string };
  model: { name: string | null; available: boolean; reason: string };
  indexer: string;
}

/** Plain-text body for the Help → Status dialog. */
export function statusText(s: StatusLike): string {
  const line = (label: string, name: string | null, ok: boolean, reason: string): string =>
    `${label}: ${name ?? 'none'} — ${ok ? 'available' : 'unavailable'} (${reason})`;
  return [
    line('Sandbox', s.sandbox.name, s.sandbox.available, s.sandbox.reason),
    line('Model', s.model.name, s.model.available, s.model.reason),
    `Indexer: ${s.indexer}`,
  ].join('\n');
}
