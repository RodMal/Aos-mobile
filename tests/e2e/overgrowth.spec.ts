/** Overgrown terrain features are marked on the board. */
import { expect, test } from '@playwright/test';
import { startGame } from './helpers.js';

test('terrain features with an overgrown token are marked on the board', async ({ page }, info) => {
  await startGame(page);
  // Round 1's Ever Growing gave a feature a token; the Wyldwood carries its own.
  const marks = page.getByTestId('overgrown-mark');
  expect(await marks.count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-overgrown="0:terrain"]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath(`overgrowth-${info.project.name}.png`) });
});
