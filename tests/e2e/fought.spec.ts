/** Units that have fought this combat phase are dimmed, badged and marked in the roster. */
import { expect, test } from '@playwright/test';
import { minimalPlayerStep, startGame } from './helpers.js';

test('units that have fought are dimmed and marked', async ({ page }, info) => {
  test.setTimeout(240_000);
  await startGame(page);
  const fought = page.locator('.unit.fought');
  let seen = false;
  for (let i = 0; i < 1500 && !seen; i++) {
    seen = (await fought.count()) > 0;
    if (!seen && (await minimalPlayerStep(page)) === null) await page.waitForTimeout(100);
  }
  expect(seen).toBe(true);
  const id = (await fought.first().getAttribute('data-unit-id'))!;
  await expect(fought.first().locator('.model').first()).toHaveCSS('opacity', '0.4');
  await expect(page.locator('.label-group', { hasText: /fighting|fought/ }).first()).toContainText(
    /fighting|fought/,
  );
  await page.screenshot({ path: info.outputPath(`fought-${info.project.name}.png`) });
  await page.getByRole('button', { name: 'Roster' }).dispatchEvent('click');
  await expect(page.locator(`[data-roster-unit="${id}"].fought`)).toContainText(/fighting|fought/);
});
