/** The reaction prompt can be collapsed to a bar to look at the map, and flags units. */
import { expect, test } from '@playwright/test';
import { minimalPlayerStep, startGame, usable } from './helpers.js';

test('a reaction can be collapsed to see the map, and a tapped unit is highlighted', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await startGame(page);
  const reaction = page.getByTestId('reaction');
  let offered = false;
  for (let i = 0; i < 600 && !offered; i++) {
    if (await usable(reaction.locator('[data-reaction-unit]').first())) {
      offered = true;
      break;
    }
    if ((await minimalPlayerStep(page)) === null) await page.waitForTimeout(100);
  }
  expect(offered).toBe(true);
  // The text names units, never bare ids.
  await expect(page.getByTestId('reaction-text')).not.toHaveText(/^\d+ /);
  const chip = reaction.locator('[data-reaction-unit]').last();
  const id = (await chip.getAttribute('data-reaction-unit'))!;
  await chip.click();
  await expect(page.locator(`[data-unit-id="${id}"].flagged`)).toHaveCount(1);
  await reaction.getByTestId('reaction-see-map').click();
  await expect(reaction).toBeHidden();
  await expect(page.getByTestId('reaction-bar')).toBeVisible();
  await expect(page.locator(`[data-unit-id="${id}"].flagged`)).toHaveCount(1);
  await page.screenshot({ path: `test-results/reaction-peek-${info.project.name}.png` });
  // R19: the log opened on top of a waiting reaction does not hide it.
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toBeVisible();
  const bar = page.getByTestId('reaction-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('waiting');
  await page.screenshot({ path: `test-results/reaction-log-${info.project.name}.png` });
  // It is on top: the tap lands on it, brings the reaction back and closes the log.
  await page.getByTestId('reaction-reopen').click();
  await expect(reaction).toBeVisible();
  await expect(page.getByTestId('log-list')).toBeHidden();
});
