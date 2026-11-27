/** Hero-phase Awakened Wyldwoods: tap the Wyldwood, Use, place the new piece. */
import { expect, test } from '@playwright/test';
import { selectFromRoster, startGame } from './helpers.js';

test('a further Awakened Wyldwood is set up in the hero phase through the place flow', async ({
  page,
}, info) => {
  await startGame(page);
  await selectFromRoster(page, '0:terrain');
  // Pieces 2 and 3 are offered, each with its shape and size; the player picks piece 3.
  const options = page.locator('[data-ability="awakened-wyldwood-setup"]');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText('piece 2');
  await expect(options.first().getByTestId('piece-shape')).toBeVisible();
  await expect(options.last()).toContainText('piece 3');
  await options.last().click();
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toContainText('Awakened Wyldwood');
  await expect(panel).toContainText('piece 3');
  await panel.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('place-panel')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`wyldwood-${info.project.name}.png`) });
  await page.getByTestId('place-confirm').click();
  await expect(page.locator('[data-unit-id="0:wyldwood2"]')).toHaveCount(1);
  // Once per hero phase: the option is gone.
  await selectFromRoster(page, '0:terrain');
  await expect(page.locator('[data-ability="awakened-wyldwood-setup"]')).toHaveCount(0);
});
