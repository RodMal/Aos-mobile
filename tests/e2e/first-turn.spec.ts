/** Round 1: the attacker (quick start) chooses who takes the first turn. */
import { expect, test } from '@playwright/test';

test('the attacker chooses who takes the first turn of round 1', async ({ page }, info) => {
  await page.goto('./?seed=5&side=0&fast=1&new=1');
  // Seasons Of War opens the battle round; all four are allowed in round 1.
  const seasons = page.getByTestId('alarielle-season');
  await expect(seasons).toBeVisible();
  await expect(seasons.locator('[data-season]:not([disabled])')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath(`seasons-${info.project.name}.png`) });
  await seasons.locator('[data-season="reaping"]').click();
  await page.locator('[data-fugitive]').first().click();
  const prompt = page.getByTestId('priority');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('First turn');
  await expect(page.getByTestId('first-turn-reason')).toHaveText('You are the attacker.');
  await page.screenshot({ path: info.outputPath(`first-turn-${info.project.name}.png`) });
  await prompt.getByRole('button', { name: 'Take second turn' }).click();
  await expect(page.getByTestId('turn')).toContainText('Seraphon');
});
