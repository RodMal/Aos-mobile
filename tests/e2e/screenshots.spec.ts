/**
 * Screenshots of the main stages, for looking at the UI. Skipped unless SHOTS is set:
 *   SHOTS=docs/screenshots pnpm test:e2e --project pixel-7 --project desktop screenshots
 * The pixel-7 project writes to <dir>/phone and the desktop project to <dir>/desktop.
 * SHOTS_DSF sets the device scale factor (default 1); SHOTS_VIEWPORT=1920x1080 resizes desktop.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  ahead,
  boardPoint,
  drag,
  endPhaseUntil,
  isDesktop,
  minimalPlayerStep,
  modelCentre,
  pinch,
  selectFromRoster,
  startDeploy,
  startGame,
} from './helpers.js';

const dir = process.env.SHOTS;
test.skip(!dir, 'set SHOTS=<dir> to take screenshots');
test.use({ deviceScaleFactor: Number(process.env.SHOTS_DSF ?? 1) });

const vp = /^(\d+)x(\d+)$/.exec(process.env.SHOTS_VIEWPORT ?? '');
if (vp) test.use({ viewport: { width: Number(vp[1]), height: Number(vp[2]) } });

function out(): string {
  const sub = `${dir}/${isDesktop() ? 'desktop' : 'phone'}`;
  mkdirSync(sub, { recursive: true });
  return sub;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out()}/${name}.png` });
}

test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name === 'iphone-14', 'one phone viewport is enough');
});

test('stages', async ({ page }) => {
  await startGame(page, 'seed=5&side=0&new=1');
  await page.waitForTimeout(400);
  await shot(page, '01-fresh-game');

  if (isDesktop()) {
    const c = await boardPoint(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -500);
  } else {
    await pinch(page, await boardPoint(page), 60, 200);
  }
  await shot(page, '02-zoomed');
  await page.getByRole('button', { name: 'Show whole table' }).click();

  await selectFromRoster(page, '0:1');
  await shot(page, '03-unit-selected');
  await page.getByTestId('details-toggle').click();
  await shot(page, '04-full-unit-card');
  await page.getByTestId('details-toggle').click();

  // The ability panel: a spell with its targets.
  await selectFromRoster(page, '0:0');
  await page.locator('[data-ability="97df-e136-9fb4-5aca"]').click();
  await expect(page.getByTestId('ability-panel')).toBeVisible();
  await shot(page, '05-ability-panel');
  await page.getByTestId('ability-cancel').click();

  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  await shot(page, '06-movement-unit-actions');
  await page.locator('[data-action="normal"]').click();
  const from = await boardPoint(page);
  await drag(page, from, await ahead(page, from, 3.5, 0.8));
  await shot(page, '07-mid-move-ghost');
  await drag(page, from, await ahead(page, from, 5));
  await expect(page.getByTestId('place-confirm')).toBeDisabled();
  await shot(page, '08-violation-too-far');
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Adjust' }).click();
  const m = await modelCentre(page, '0:6', 0, true);
  await drag(page, m, await ahead(page, m, 0.35));
  await shot(page, '09-adjust-single-model');
  await page.getByTestId('place-cancel').click();

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Roster' }).click();
  await shot(page, '10-roster');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Log' }).click();
  await shot(page, '11-log');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('menu-button').click();
  await shot(page, '12-menu');
  await page.getByTestId('open-army-rules').click();
  await shot(page, '13-army-rules');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('end-phase').click();
  await page.getByTestId('confirm-ok').click();
  await page.getByRole('button', { name: 'Show whole table' }).click();
  await shot(page, '14-shooting-phase');
});

test('attack panel', async ({ page }) => {
  test.setTimeout(120_000);
  // Nobody can shoot at the start, so play on until the opponent's attack makes us fight back.
  await startGame(page, 'seed=3&side=0&fast=1&new=1');
  const panel = page.getByTestId('attack-panel');
  for (let i = 0; i < 2000 && !(await panel.isVisible()); i++) {
    if (!(await minimalPlayerStep(page))) await page.waitForTimeout(100);
  }
  await expect(panel).toBeVisible();
  await shot(page, '15-attack-panel');
});

test('reaction prompt', async ({ page }) => {
  test.setTimeout(120_000);
  await startGame(page, 'seed=3&side=0&fast=1&new=1');
  const reaction = page.getByTestId('reaction');
  const unbind = reaction.getByRole('button', { name: /^Unbind/ }).first();
  for (let i = 0; i < 600 && !(await unbind.isVisible()); i++) {
    if (!(await minimalPlayerStep(page))) await page.waitForTimeout(100);
  }
  await expect(reaction).toBeVisible();
  await shot(page, '16-reaction-prompt');
});

test('deployment flow', async ({ page }) => {
  await startDeploy(page);
  await shot(page, '17-deployment');
});

test('end screen', async ({ page }) => {
  test.setTimeout(180_000);
  await startGame(page, 'seed=8&side=0&fast=1&new=1');
  for (let i = 0; i < 4000 && !(await page.getByTestId('game-end').isVisible()); i++) {
    if (!(await minimalPlayerStep(page))) await page.waitForTimeout(100);
  }
  await expect(page.getByTestId('game-end')).toBeVisible();
  await shot(page, '18-game-end');
});
