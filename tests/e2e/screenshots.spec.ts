/**
 * Screenshots of the main stages, for looking at the UI. Skipped unless SHOTS is set:
 *   SHOTS=docs/screenshots SHOTS_DSF=2 pnpm test:e2e --project pixel-7 screenshots
 */
import { expect, test, type Page } from '@playwright/test';
import {
  boardPoint,
  boardScale,
  endPhaseUntil,
  modelCentre,
  pinch,
  selectFromRoster,
  startGame,
  touchDrag,
} from './helpers.js';

const dir = process.env.SHOTS;
test.skip(!dir, 'set SHOTS=<dir> to take screenshots');
test.use({ deviceScaleFactor: Number(process.env.SHOTS_DSF ?? 1) });

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/${name}.png` });
}

test('stages', async ({ page }, info) => {
  test.skip(info.project.name !== 'pixel-7', 'one viewport is enough');
  await startGame(page, 'seed=5&side=0&new=1');
  await page.waitForTimeout(400);
  await shot(page, '01-fresh-game');

  await pinch(page, await boardPoint(page), 60, 200);
  await shot(page, '02-pinch-zoomed');

  await selectFromRoster(page, '0:1');
  await shot(page, '03-unit-selected');
  await page.getByTestId('details-toggle').click();
  await shot(page, '04-full-unit-card');
  await page.getByTestId('details-toggle').click();

  await endPhaseUntil(page, /Movement/);
  await selectFromRoster(page, '0:6');
  await shot(page, '05-movement-unit-actions');
  await page.locator('[data-action="normal"]').click();
  const scale = await boardScale(page);
  const from = await boardPoint(page);
  await touchDrag(page, from, { x: from.x + 0.8 * scale, y: from.y - 3.5 * scale });
  await shot(page, '06-mid-move-ghost');
  await touchDrag(page, from, { x: from.x, y: from.y - 5 * scale });
  await expect(page.getByTestId('place-confirm')).toBeDisabled();
  await shot(page, '07-violation-too-far');
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Adjust' }).click();
  const m = await modelCentre(page, '0:6', 0, true);
  await touchDrag(page, m, { x: m.x, y: m.y - 0.35 * scale });
  await shot(page, '08-adjust-single-model');
  await page.getByTestId('place-cancel').click();

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Roster' }).click();
  await shot(page, '09-roster');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Log' }).click();
  await shot(page, '10-log');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('menu-button').click();
  await shot(page, '11-menu');
  await page.getByTestId('open-army-rules').click();
  await shot(page, '12-army-rules');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('end-phase').click();
  await page.getByTestId('confirm-ok').click();
  await page.getByRole('button', { name: 'Show whole table' }).click();
  await shot(page, '13-shooting-phase');
});

test('end screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'pixel-7', 'one viewport is enough');
  await startGame(page, 'seed=8&side=0&fast=1&new=1');
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId('game-end').isVisible()) break;
    const end = page.getByTestId('end-phase');
    if (await end.isVisible()) {
      await end.click();
      const ok = page.getByTestId('confirm-ok');
      if (await ok.isVisible()) await ok.click();
    } else await page.waitForTimeout(50);
  }
  await expect(page.getByTestId('game-end')).toBeVisible();
  await shot(page, '14-game-end');
});
