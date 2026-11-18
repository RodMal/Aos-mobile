/** Redeploy: offered once, when the enemy ends its movement phase, and can be used. */
import { expect, test } from '@playwright/test';
import { minimalPlayerStep, startGame, usable } from './helpers.js';

test('the player is offered Redeploy when the enemy ends its movement phase and can use it', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await startGame(page);
  const reaction = page.getByTestId('reaction');
  const redeploy = reaction.getByRole('button', { name: /^Redeploy · / });
  let offered = false;
  for (let i = 0; i < 600 && !offered; i++) {
    if (await usable(redeploy.first())) {
      offered = true;
      break;
    }
    if ((await minimalPlayerStep(page)) === null) await page.waitForTimeout(100);
  }
  expect(offered).toBe(true);
  await page.screenshot({ path: `test-results/redeploy-${info.project.name}.png` });
  await redeploy.first().click();
  // The D6" move is placed through the place panel like any other move.
  await expect(page.getByTestId('place-panel')).toBeVisible();
  await expect(page.getByTestId('place-panel')).toContainText('Move');
});
