// End-to-end: launches the bundled app in Electron through Playwright and drives it like a user.
// Needs a display (run under xvfb-run) and `node build.ts` first. Skips cleanly when Playwright is not installed.
// In root containers set MINDMELD_ELECTRON_NO_SANDBOX=1: Chromium refuses to start as root with its OS sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
type Main = typeof import('electron');
const WAIT_MS = 20_000;
const POLL_MS = 50;
const HTTP_OK = 200;
const desktop = fileURLToPath(new URL('..', import.meta.url));
const mainBundle = join(desktop, 'dist', 'main.mjs');
const fixture = fileURLToPath(new URL('../../../fixtures/combat-game', import.meta.url));

function loadPlaywright(): any {
  try { return require('playwright'); } catch { return null; }
}
const playwright = loadPlaywright();
const skip = !playwright ? 'playwright is not installed' : !existsSync(mainBundle) ? 'run `node build.ts` first' : false;

/** Polls until `check` returns a truthy value, failing after WAIT_MS. */
async function until<T>(what: string, check: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

test('desktop app: login, API via cookie, confinement, menus, clean quit', { skip }, async () => {
  const userData = mkdtempSync(join(tmpdir(), 'mindmeld-desktop-'));
  const exportFile = join(userData, 'usage.jsonl');
  const args = process.env.MINDMELD_ELECTRON_NO_SANDBOX === '1' ? ['--no-sandbox', mainBundle] : [mainBundle];
  const env = { ...process.env, MINDMELD_USER_DATA_DIR: userData, MINDMELD_SANDBOX: 'none', MINDMELD_MODEL_PROVIDER: 'none' };
  const app = await playwright._electron.launch({ executablePath: require('electron') as string, args, env, timeout: WAIT_MS });
  try {
    const page = await app.firstWindow({ timeout: WAIT_MS });
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: WAIT_MS });
    const origin = new URL(page.url()).origin;

    // The cookie set by /auth authenticates same-origin API calls; the token never reaches the page.
    const api = await page.evaluate(async () => {
      const [status, usage] = await Promise.all([fetch('/api/status'), fetch('/api/usage')]);
      return { status: status.status, usage: usage.status, body: await status.json(), cookie: document.cookie };
    });
    assert.equal(api.status, HTTP_OK);
    assert.equal(api.usage, HTTP_OK);
    assert.equal(api.body.sandbox.name, 'disabled');
    assert.match(api.body.indexer, /rust\/.* python\/.* gdscript\//, 'the bundled backend loads the tree-sitter grammars');
    assert.equal(api.cookie, '', 'session cookie must be HttpOnly');

    // Record main-process side effects instead of opening real dialogs or a real browser.
    await app.evaluate(({ dialog, shell, webContents }: Main, paths: { fixture: string; exportFile: string }) => {
      const g = globalThis as any;
      g.e2e = { external: [], boxes: [], navigations: [] };
      (shell as any).openExternal = (url: string) => { g.e2e.external.push(url); return Promise.resolve(); };
      (dialog as any).showMessageBox = (...a: any[]) => { g.e2e.boxes.push(a.at(-1)); return Promise.resolve({ response: 0, checkboxChecked: false }); };
      (dialog as any).showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [paths.fixture] });
      (dialog as any).showSaveDialog = () => Promise.resolve({ canceled: false, filePath: paths.exportFile });
      for (const wc of webContents.getAllWebContents()) {
        wc.on('will-navigate', (event: any, url: string) => { g.e2e.navigations.push({ url, prevented: event.defaultPrevented }); });
      }
    }, { fixture, exportFile });
    const e2e = (): Promise<any> => app.evaluate(() => (globalThis as any).e2e);

    // External navigation is blocked in-window.
    await page.evaluate(() => { location.href = 'https://example.com/'; });
    const nav = await until('will-navigate', async () => (await e2e()).navigations[0]);
    assert.deepEqual(nav, { url: 'https://example.com/', prevented: true });
    assert.equal(new URL(page.url()).origin, origin);

    // window.open is always denied; external http(s) goes to the system browser, same-origin is dropped.
    const opened = await page.evaluate(() => [window.open('https://example.com/docs'), window.open('/elsewhere')].map(w => w === null));
    assert.deepEqual(opened, [true, true]);
    assert.deepEqual((await e2e()).external, ['https://example.com/docs']);
    assert.equal(app.windows().length, 1);

    const click = (id: string): Promise<void> => app.evaluate(({ Menu }: Main, itemId: string) => { Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(); }, id);

    // File → Open Folder indexes a project, which records usage.
    await click('file-open-folder');
    // The window reloads after indexing, which can destroy an in-flight evaluate; that just means "poll again".
    const projects = (): Promise<boolean> => page.evaluate(async () => (await (await fetch('/api/projects')).json()).length > 0);
    await until('the project to be indexed', () => projects().catch(() => false));
    await page.waitForLoadState('load');

    // Help → Usage shows the shareable summary and "Copy" puts it on the clipboard.
    await click('help-usage');
    const box = await until('the usage dialog', async () => (await e2e()).boxes[0]);
    assert.match(box.detail, /^Mind Meld usage since .*: 1 operations, 0 failed/);
    assert.match(box.detail, /^Tokens: in /m);
    assert.match(box.detail, /^Last 5h: 1 operations/m);
    assert.match(box.detail, /^Last 7d: 1 operations/m);
    assert.deepEqual(box.buttons, ['Copy', 'Close']);
    assert.equal(await app.evaluate(({ clipboard }: Main) => clipboard.readText()), box.detail);

    // File → Export Usage writes one JSON record per line.
    await click('file-export-usage');
    const exported = await until('the usage export', () => Promise.resolve(existsSync(exportFile) && readFileSync(exportFile, 'utf8')));
    const records = String(exported).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, 'index');

    // Quit closes the server and store, then exits 0.
    const exited = new Promise<number | null>(resolve => app.process().once('exit', resolve));
    await app.evaluate(({ app: electronApp }: Main) => { electronApp.quit(); });
    assert.equal(await exited, 0);
    await assert.rejects(fetch(`${origin}/api/status`));
  } finally {
    if (app.process().exitCode === null) await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
