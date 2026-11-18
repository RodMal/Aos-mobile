import { expect, test, type Page } from '@playwright/test';
import { startGame } from './helpers.js';

const KEY = 'aos-mobile:game';

/** Loads the bare URL (no game named), which shows the start screen. */
async function openStart(page: Page): Promise<void> {
  await page.goto('./?fast=1');
  await expect(page.getByTestId('start-screen')).toBeVisible();
}

test('no saved game: the start screen offers New game only', async ({ page }) => {
  await openStart(page);
  await expect(page.getByTestId('continue-game')).toHaveCount(0);
  await expect(page.getByTestId('start-new-game')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveCount(0);
  await page.screenshot({ path: `test-results/start-${test.info().project.name}.png` });
});

test('a saved game: Continue resumes it exactly', async ({ page }) => {
  await startGame(page);
  const saved = await page.evaluate((k) => localStorage.getItem(k), KEY);
  await page.goto('./?fast=1');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await page.screenshot({ path: `test-results/start-save-${test.info().project.name}.png` });
  await page.getByTestId('continue-game').click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.locator('[data-unit-id] [data-model]').first()).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(saved);
});

test('a saved game that no longer replays shows the start screen without Continue', async ({
  page,
}) => {
  await page.goto('./?fast=1');
  await page.evaluate(
    (k) =>
      localStorage.setItem(
        k,
        JSON.stringify({ v: 1, seed: 5, humanPlayer: 0, actions: [{ t: 'nonsense' }] }),
      ),
    KEY,
  );
  await page.reload();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(page.getByTestId('continue-game')).toHaveCount(0);
});

for (const side of [0, 1]) {
  for (const mode of ['Quick start', 'Alternating deploy']) {
    test(`New game as side ${side}, ${mode}`, async ({ page }) => {
      await openStart(page);
      await page.getByRole('radiogroup', { name: 'Play as' }).getByRole('radio').nth(side).click();
      await page.getByRole('radio', { name: mode }).click();
      await page.getByTestId('start-new-game').click();
      await expect(page.getByTestId('board')).toBeVisible();
      if (mode === 'Quick start') {
        await expect(page.locator('[data-unit-id] [data-model]').first()).toBeVisible();
      } else {
        await expect(page.locator('[data-unit-id] [data-model]')).toHaveCount(0);
      }
      const rec = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!);
      expect(rec.humanPlayer).toBe(side);
    });
  }
}
