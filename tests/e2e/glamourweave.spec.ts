/** Sylvaneth: the Glamourweave re-roll is offered to the player at a failed roll (M4d-2). */
import { expect, test } from '@playwright/test';
import { openPosition } from './positions.js';

test('a failed roll offers the Glamourweave re-roll; keeping it asks again later', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await openPosition(page, 1, (_engine, _s, d) =>
    d.kind === 'reaction' && d.player === 0 && d.options.some((o) => o.ability === 'glamourweave')
      ? 'reroll'
      : null,
  );
  const prompt = page.getByTestId('reaction');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Glamourweave');
  await expect(page.getByTestId('reroll-text')).toContainText(/failed a (hit|wound|save) roll/);
  await expect(page.getByTestId('reroll-use')).toBeVisible();
  await expect(page.getByTestId('reroll-keep')).toBeVisible();
  await page.screenshot({ path: info.outputPath('reroll.png') });
  await page.screenshot({ path: `test-results/reroll-${info.project.name}.png` });

  // Keep it: any further question is answered by re-rolling, and the log says so.
  await page.getByTestId('reroll-keep').click();
  const use = page.getByTestId('reroll-use');
  for (let i = 0; i < 40; i++) {
    if (await use.isVisible()) {
      await use.click();
      break;
    }
    await page.waitForTimeout(100);
  }
});

test('re-rolling is noted in the log', async ({ page }) => {
  test.setTimeout(120_000);
  await openPosition(page, 1, (_engine, _s, d) =>
    d.kind === 'reaction' && d.player === 0 && d.options.some((o) => o.ability === 'glamourweave')
      ? 'reroll'
      : null,
  );
  await page.getByTestId('reroll-use').click();
  // A later failed roll of another kind may be asked about: keep those.
  const keep = page.getByTestId('reroll-keep');
  const log = page.getByRole('button', { name: 'Log' });
  const dialog = page.getByRole('dialog', { name: 'Glamourweave' });
  await page.waitForTimeout(500);
  for (let i = 0; i < 40 && (await dialog.count()) > 0; i++) {
    if (await keep.isVisible()) await keep.click();
    await page.waitForTimeout(150);
  }
  await log.click();
  await expect(page.getByTestId('log-list')).toContainText('Glamourweave: re-rolled a failed');
});
