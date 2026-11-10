// Pure window-security decisions for the desktop shell. No Electron runtime imports, so node:test covers them.
import type { WebPreferences } from 'electron';

/** What to do with a link the page tries to open in a new window. */
export type OpenAction = 'open-external' | 'deny';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

function parse(raw: string): URL | null {
  try { return new URL(raw); } catch { return null; }
}

/** Origin of the in-process server, e.g. `http://127.0.0.1:43210`. */
export function serverOrigin(serverUrl: string): string {
  return new URL(serverUrl).origin;
}

/** In-window navigation is allowed only within the local server's exact origin. */
export function isAllowedNavigation(target: string, origin: string): boolean {
  const url = parse(target);
  return url !== null && url.origin === origin;
}

/**
 * New windows are always denied. An external http(s) link goes to the system browser instead; everything else
 * (same-origin pages, file:, javascript:, custom schemes) is simply dropped.
 */
export function windowOpenAction(target: string, origin: string): OpenAction {
  const url = parse(target);
  if (!url || url.origin === origin || !EXTERNAL_PROTOCOLS.has(url.protocol)) return 'deny';
  return url.username || url.password ? 'deny' : 'open-external';
}

/** One-time login URL: the server swaps the token for an HttpOnly session cookie and redirects to `/`. */
export function loginUrl(serverUrl: string, token: string): string {
  const url = new URL('/auth', serverUrl);
  url.searchParams.set('token', token);
  return url.href;
}

/** Locked-down renderer settings: isolated, sandboxed, no Node, no <webview>, no preload bridge. */
export function webPreferences(): WebPreferences {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    spellcheck: false,
  };
}
