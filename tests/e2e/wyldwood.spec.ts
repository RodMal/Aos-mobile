/** Hero-phase Awakened Wyldwoods: tap the Wyldwood, Use, place the new piece. */
import { expect, test } from '@playwright/test';
import { selectFromRoster, startGame } from './helpers.js';

test('a further Awakened Wyldwood is set up in the hero phase through the place flow', async ({
  page,
}, info) => {
  await startGame(page);
  await selectFromRoster(page, '0:terrain');
  await page.locator('[data-ability="awakened-wyldwood-setup"]').click();
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toContainText('Awakened Wyldwood');
  await panel.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('place-panel')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`wyldwood-${info.project.name}.png`) });
  await page.getByTestId('place-confirm').click();
  await expect(page.locator('[data-unit-id="0:wyldwood2"]')).toHaveCount(1);
  // Once per hero phase: the option is gone.
  await selectFromRoster(page, '0:terrain');
  await expect(page.locator('[data-ability="awakened-wyldwood-setup"]')).toHaveCount(0);
});
