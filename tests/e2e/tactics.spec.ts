/** The battle tactics tracker: one tap from the top bar on every project. */
import { expect, test } from '@playwright/test';
import { answerPreBattle, isDesktop, startGame } from './helpers.js';

test('the top bar opens the battle tactics tracker with both armies’ cards and tiers', async ({
  page,
}, info) => {
  await startGame(page);
  const button = page.getByTestId('tactics-button');
  await expect(button).toBeVisible();
  // Twelve pips: two cards of three tiers for each side.
  await expect(button.locator('.pip')).toHaveCount(12);
  await page.screenshot({ path: info.outputPath(`tactics-closed-${info.project.name}.png`) });
  await button.click();
  const panel = page.getByTestId('tactics-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('tactic-card')).toHaveCount(4);
  const first = panel.getByTestId('tactic-card').first();
  await expect(first.getByTestId('tier-affray')).toHaveAttribute('data-status', 'next');
  await expect(first.getByTestId('tier-strike')).toHaveAttribute('data-status', 'later');
  await expect(first.getByTestId('tactic-next')).toContainText('You complete this battle tactic');
  await page.screenshot({ path: info.outputPath(`tactics-${info.project.name}.png`) });
  // On desktop the tracker is also in view in the sheet, without opening anything.
  await expect(page.getByTestId('tactics-sheet')).toBeVisible({ visible: isDesktop() });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
});

test('Burning for Vengeance asks the player to pick the fugitive, and the tracker shows it', async ({
  page,
}, info) => {
  await page.goto('./?seed=5&side=0&fast=1&new=1');
  await page.locator('[data-season]:not([disabled])').first().click();
  const prompt = page.getByTestId('fugitive');
  await expect(prompt).toBeVisible();
  const choices = prompt.locator('[data-fugitive]');
  expect(await choices.count()).toBeGreaterThan(1);
  await page.screenshot({ path: info.outputPath(`fugitive-${info.project.name}.png`) });
  const last = choices.last();
  const name = ((await last.textContent()) ?? '').replace(/ · in reserve$/, '').trim();
  await last.click();
  await expect(prompt).toBeHidden();
  await answerPreBattle(page);
  await page.getByTestId('tactics-button').click();
  await expect(page.getByTestId('tactics-panel')).toContainText(`Fugitive: ${name}`);
});
