// Mind Meld Studio desktop shell — Electron main process.
//
// Decision (orchestrator, 2026-11-10): Electron with a TypeScript main process, not the Tauri shell the initial
// plan proposed. The repo's default language is TypeScript (.agent/default-language.md) and a Rust shell would need
// owner approval; Electron lets the desktop app run the existing TypeScript backend in-process.
//
// The backend (Studio + HTTP server) runs inside this process on 127.0.0.1 with a random port and a fresh token.
// The window logs in once through /auth?token=…, which swaps the token for an HttpOnly cookie; the renderer is
// sandboxed, isolated and confined to the server's origin.
import { app, BrowserWindow, Menu, session, shell, type WebContents } from 'electron';
import { randomBytes } from 'node:crypto';
import { delimiter, join } from 'node:path';
import { launch } from '@mindmeld/server';
import { menuActions } from './actions.ts';
import { menuTemplate } from './menu.ts';
import { isAllowedNavigation, loginUrl, serverOrigin, webPreferences, windowOpenAction } from './policy.ts';
import { loginShellPath, mergePath } from './shell-path.ts';

const TOKEN_BYTES = 32;
const WINDOW_SIZE = { width: 1280, height: 860, minWidth: 720, minHeight: 480 };
const EXIT_OK = 0;
const EXIT_FAILURE = 1;

type Backend = Awaited<ReturnType<typeof launch>>;
let backend: Backend | null = null;
let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;

/** Packaged builds ship the web UI under resources/web; dev builds use the server's default (packages/web/dist). */
function webDir(): string | undefined {
  return app.isPackaged ? join(process.resourcesPath, 'web') : undefined;
}

function confine(contents: WebContents, origin: string): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (windowOpenAction(url, origin) === 'open-external') void shell.openExternal(url);
    return { action: 'deny' };
  });
  const guard = (event: Electron.Event, url: string): void => { if (!isAllowedNavigation(url, origin)) event.preventDefault(); };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
}

function lockDown(origin: string): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_event, contents) => confine(contents, origin));
}

function openWindow(url: string): void {
  mainWindow = new BrowserWindow({ ...WINDOW_SIZE, title: 'Mind Meld Studio', show: false, webPreferences: webPreferences() });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL(url);
}

/** GUI launches get a minimal PATH; merge in the login shell's so local agent CLIs are detected. */
async function adoptLoginPath(): Promise<void> {
  const login = await loginShellPath(process.env, process.platform);
  if (login) process.env.PATH = mergePath(process.env.PATH, login, delimiter);
}

async function start(): Promise<void> {
  await app.whenReady();
  await adoptLoginPath();
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const dataDir = join(app.getPath('userData'), 'studio');
  backend = await launch({ env: process.env, dataDir, host: '127.0.0.1', port: 0, token, webDir: webDir() });
  for (const note of backend.notes) console.log(`note: ${note}`);
  const { studio, running } = backend;
  lockDown(serverOrigin(running.url));
  const actions = menuActions(studio, () => mainWindow, app.getPath('downloads'));
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(actions, { dev: !app.isPackaged, mac: process.platform === 'darwin' })));
  openWindow(loginUrl(running.url, running.token));
}

/** Closes the HTTP server, then the SQLite store. Idempotent. */
async function shutdown(): Promise<void> {
  const current = backend;
  backend = null;
  if (!current) return;
  try { await current.running.close(); } finally { current.studio.store.close(); }
}

function onBeforeQuit(event: Electron.Event): void {
  if (!backend && !shuttingDown) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  shutdown().catch((error: unknown) => console.error('shutdown failed', error)).finally(() => app.exit(EXIT_OK));
}

function main(): void {
  if (process.env.MINDMELD_USER_DATA_DIR) app.setPath('userData', process.env.MINDMELD_USER_DATA_DIR);
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', onBeforeQuit);
  start().catch((error: unknown) => {
    console.error('Mind Meld Studio failed to start', error);
    app.exit(EXIT_FAILURE);
  });
}

main();
