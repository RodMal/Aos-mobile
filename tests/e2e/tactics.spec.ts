/** The battle tactics tracker: one tap from the top bar on every project. */
import { expect, test } from '@playwright/test';
import { startGame } from './helpers.js';

test('the top bar opens the battle tactics tracker with both armies’ cards and tiers', async ({
  page,
}, info) => {
  await startGame(page);
  const button = page.getByTestId('tactics-button');
  await expect(button).toBeVisible();
  // Twelve pips: two cards of three tiers for each side.
  await expect(button.locator('.pip')).toHaveCount(12);
  await button.click();
  const panel = page.getByTestId('tactics-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('tactic-card')).toHaveCount(4);
  const first = panel.getByTestId('tactic-card').first();
  await expect(first.getByTestId('tier-affray')).toHaveAttribute('data-status', 'next');
  await expect(first.getByTestId('tier-strike')).toHaveAttribute('data-status', 'later');
  await expect(first.getByTestId('tactic-next')).toContainText('You complete this battle tactic');
  await page.screenshot({ path: info.outputPath(`tactics-${info.project.name}.png`) });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
});
