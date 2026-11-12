import { expect, test } from '@playwright/test';
import { answerPreBattle, startGame } from './helpers.js';

test('the app works offline once the service worker is active', async ({ page, context }) => {
  await startGame(page);
  // Wait until the service worker is active and controlling this page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.goto('./?seed=5&side=0&fast=1&new=1');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('[data-unit-id] [data-model]').first()).toBeVisible();
  await answerPreBattle(page);
  await page.getByRole('button', { name: 'Roster' }).click();
  await page.locator('[data-roster-unit]').first().click();
  await expect(page.getByTestId('unit-panel')).toBeVisible();
});
