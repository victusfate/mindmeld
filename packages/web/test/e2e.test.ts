// End-to-end: build the UI, serve it from the real server with a test sandbox and scripted model, and drive it
// in Chromium. Playwright is pre-installed globally (not a dependency); the test skips when it is missing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, Studio } from '@mindmeld/core';
import { LocalDirectorySource } from '@mindmeld/connectors';
import { startServer } from '@mindmeld/server';
import { HostProcessSandbox, ScriptedModel, copyFixture } from '../../core/test/helpers.ts';
import { build } from '../build.ts';

interface Pw { chromium: { launch(): Promise<any> } }
function loadPlaywright(): Pw | null {
  try { return createRequire(import.meta.url)('playwright') as Pw; } catch { return null; }
}

const pw = loadPlaywright();
const NORMAL = '[{"name":"hero","hp":10,"attack":7,"armor":1},{"name":"slime","hp":5,"attack":2,"armor":2}]';
const CRITICAL = '[{"name":"hero","hp":10,"attack":100,"armor":1},{"name":"slime","hp":5,"attack":2,"armor":2}]';
const LEGACY_EDGE = 's:src/combat.ts#attack→src/combat.ts#legacyCritical:call';
const SCREENSHOT = process.env.MM_SCREENSHOT ?? join(tmpdir(), 'mindmeld-studio-e2e.png');
const WAIT = { timeout: 15_000 };

test('studio UI: import, map, allowlist, run, replay, compare, ask, usage, availability', { skip: pw ? false : 'playwright not installed' }, async () => {
  const webDir = await build(mkdtempSync(join(tmpdir(), 'mm-web-dist-')));
  const sandbox = new HostProcessSandbox();
  const model = new ScriptedModel(() => 'playTurn attacks and then saves the defender [S:src/game.ts#playTurn]. It also emails the player [S:src/mail.ts#send].');
  const studio = new Studio({ store: new EvidenceStore(':memory:'), sandbox, model, sources: [new LocalDirectorySource()] });
  const srv = await startServer({ studio, webDir, token: 'e2e-token-0123456789' });
  const browser = await pw!.chromium.launch();
  after(async () => { await browser.close(); await srv.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const problems: string[] = [];
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e: Error) => problems.push(e.message));
  const shot = (name: string): Promise<unknown> => page.screenshot({ path: SCREENSHOT.replace(/\.png$/, `-${name}.png`) });

  await page.goto(`${srv.url}/auth?token=e2e-token-0123456789`);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const repo = copyFixture();
  await page.locator('#import-ref').fill(repo);
  await page.locator('form.import-form button[type=submit]').click();

  await page.locator('[data-symbol="src/combat.ts#legacyCritical"]').waitFor(WAIT);
  const legacy = page.locator(`.react-flow__edge.edge-static[data-id="${LEGACY_EDGE}"]`);
  await legacy.waitFor({ state: 'attached', ...WAIT });
  assert.equal(await page.locator('.react-flow__edge.edge-observed').count(), 0, 'no observed edges before any run');
  await shot('map');

  await page.locator('[data-symbol="src/game.ts#playTurn"]').click();
  await page.getByRole('button', { name: 'Allowlist as entry' }).click();
  await page.getByText('allowlisted entry', { exact: true }).waitFor(WAIT);

  await page.getByRole('tab', { name: 'run' }).click();
  await page.locator('#inputs').fill(NORMAL);
  await page.getByTestId('run-button').click();
  await page.getByTestId('replay-step').waitFor(WAIT);
  const first = await page.getByTestId('replay-step').textContent();
  assert.match(first ?? '', /^1 \/ \d+$/);
  await page.getByTestId('replay-next').click();
  assert.match(await page.getByTestId('replay-step').textContent() ?? '', /^2 \/ \d+$/);
  await page.locator('.react-flow__edge.edge-observed').first().waitFor(WAIT);

  await page.getByRole('tab', { name: 'run' }).click();
  await page.locator('#inputs').fill(CRITICAL);
  await page.getByTestId('run-button').click();
  await page.getByTestId('replay-step').waitFor(WAIT);

  await page.getByRole('tab', { name: 'compare' }).click();
  await page.getByTestId('compare-A').selectOption({ index: 2 });
  await page.getByTestId('compare-B').selectOption({ index: 1 });
  await page.getByTestId('only-b').getByText('legacyCritical').waitFor(WAIT);
  await shot('compare');

  await page.getByRole('tab', { name: 'ask' }).click();
  await page.locator('#question').fill('What does playTurn do?');
  await page.getByTestId('ask-button').click();
  await page.getByTestId('answer').waitFor(WAIT);
  assert.equal(await page.locator('[data-testid=answer] .answer-text [data-testid=citation]').first().textContent(), '[S:src/game.ts#playTurn]');
  const usageLine = await page.getByTestId('answer-usage').textContent() ?? '';
  assert.match(usageLine, /model scripted-1/);
  assert.match(usageLine, /100 in \/ 20 out/);
  assert.match(usageLine, /cache unknown read \/ unknown write/);
  assert.match(usageLine, /\$0\.0010/);
  await page.getByTestId('reveal-unsupported').click();
  await page.getByTestId('unsupported').getByText('emails the player').waitFor(WAIT);
  await shot('ask');

  await page.getByTestId('usage-chip').getByText('$0.0010').waitFor(WAIT);
  await page.getByRole('tab', { name: 'replay' }).click();
  await page.screenshot({ path: SCREENSHOT });
  await page.getByTestId('usage-chip').click();
  assert.equal(await page.getByTestId('usage-cost').textContent(), '$0.0010');
  await page.getByTestId('usage-windows').waitFor(WAIT);
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('usage-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  appendFileSync(join(repo, 'src/combat.ts'), '\n// edited after the runs\n');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByTestId('stale-runs').getByText('2 stale runs not drawn').waitFor(WAIT);
  assert.equal(await page.locator('.react-flow__edge.edge-observed').count(), 0, 'stale runs add no observed edges');
  await page.getByRole('tab', { name: 'run' }).click();
  assert.equal(await page.getByTestId('runs').locator('.badge-stale').count(), 2);

  sandbox.available = false;
  await page.reload();
  await page.getByTestId('banner').waitFor(WAIT);
  await page.getByRole('tab', { name: 'run' }).click();
  assert.equal(await page.getByTestId('run-button').isDisabled(), true);
  await page.locator('[data-symbol="src/game.ts#playTurn"]').click();
  await page.locator('.code li.hl').first().waitFor(WAIT);
  await shot('sandbox-off');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('narrow');

  assert.deepEqual(problems, [], `console errors or CSP violations: ${problems.join('\n')}`);
});
