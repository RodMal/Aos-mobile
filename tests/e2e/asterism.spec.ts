/** Seraphon: The Great Plan is asked before round 1, and Sotek's +2 Move shows on the card. */
import { expect, test } from '@playwright/test';
import { selectFromRoster } from './helpers.js';

test('The Great Plan: pick an Asterism; Sotek the Deliverer adds 2 to the Move shown', async ({
  page,
}, info) => {
  await page.goto('./?seed=5&side=1&fast=1&new=1');
  const prompt = page.getByTestId('asterism');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('The Great Plan');
  await expect(prompt.locator('[data-asterism]')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath(`great-plan-${info.project.name}.png`) });
  await prompt.locator('[data-asterism="6960-effd-2a46-d7d4"]').click();
  await expect(prompt).toBeHidden();
  // The fugitive, the first turn and a Place of Power may follow; answer each until the board is free.
  const popup = page.locator('.modal-wrap');
  await page.waitForTimeout(800);
  for (let i = 0; i < 8 && (await popup.isVisible().catch(() => false)); i++) {
    if (
      await page
        .locator('[data-fugitive]')
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await page.locator('[data-fugitive]').first().click();
    } else if (
      await page
        .getByTestId('priority')
        .isVisible()
        .catch(() => false)
    ) {
      await page.getByTestId('priority').getByRole('button', { name: 'Take first turn' }).click();
    } else {
      await popup.getByRole('button', { name: /^(Pass|Skip)$/ }).click();
    }
    await page.waitForTimeout(500);
  }
  // Saurus Warriors have Move 5": 7" once Sotek is prophesied.
  await selectFromRoster(page, '1:5');
  await expect(page.getByTestId('stat-line')).toContainText('7"');
});
