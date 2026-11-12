/** The end-of-turn scoring summary and the log's "Scores by turn". */
import { expect, test } from '@playwright/test';
import { answerOpponentTurnPrompt, minimalPlayerStep, startGame, usable } from './helpers.js';

test('each turn ends with a scoring summary that can be dismissed and reviewed in the log', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  // `summary=1` shows the summary although `fast=1` (tests) hides it by default.
  await startGame(page, 'seed=5&side=0&fast=1&new=1&summary=1');
  const summary = page.getByTestId('turn-summary');
  let shown = false;
  for (let i = 0; i < 800 && !shown; i++) {
    // Wait for a summary that scored something, so the lines are visible.
    if ((await summary.isVisible()) && (await summary.locator('li').count()) > 0) {
      shown = true;
      break;
    }
    if (await usable(page.getByTestId('turn-summary-close'))) {
      await page.getByTestId('turn-summary-close').click();
      continue;
    }
    if ((await minimalPlayerStep(page)) === null) await page.waitForTimeout(100);
  }
  expect(shown).toBe(true);
  await expect(summary).toContainText(/Round \d/);
  await expect(summary).toContainText(/\+\d/);
  await expect(summary).toContainText('This turn:');
  await expect(summary).toContainText('Total:');
  await expect(summary.locator('li').first()).toContainText(/Controlled|—/);
  await page.screenshot({ path: `test-results/turn-summary-${info.project.name}.png` });
  const text = (await summary.locator('li').first().textContent()) ?? '';
  await page.getByTestId('turn-summary-close').click();
  await expect(summary).toHaveCount(0);
  // Past turns are in the battle log.
  // A start-of-turn prompt or reaction may stand in front of the log button: answer it first.
  await expect(async () => {
    await answerOpponentTurnPrompt(page);
    await page.getByRole('button', { name: 'Log' }).click({ timeout: 1000 });
  }).toPass();
  const scores = page.getByTestId('turn-scores');
  await scores.locator('summary').click();
  await expect(scores).toContainText(
    text
      .replace(/\+\d+$/, '')
      .trim()
      .slice(0, 20),
  );
  await page.screenshot({ path: `test-results/turn-scores-log-${info.project.name}.png` });
});
