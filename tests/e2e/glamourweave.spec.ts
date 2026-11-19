/** Sylvaneth: the Glamourweave re-roll is offered to the player at a failed roll (M4d-2). */
import { expect, test } from '@playwright/test';
import { openPosition } from './positions.js';

test('a failed roll offers the Glamourweave re-roll; keeping it asks again later', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  // A position where keeping the first failed roll leads to a second question.
  await openPosition(page, 1, (engine, s, d) => {
    const asks = (st: typeof s) => {
      const x = engine.decision(st);
      return x?.kind === 'reaction' && x.options.some((o) => o.ability === 'glamourweave');
    };
    if (d.kind !== 'reaction' || d.player !== 0 || !asks(s)) return null;
    return asks(engine.apply(s, { t: 'pass' }).state) ? 'twice' : null;
  });
  const prompt = page.getByTestId('reaction');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Glamourweave');
  await expect(page.getByTestId('reroll-text')).toContainText(/failed a (hit|wound|save) roll/);
  await expect(page.getByTestId('reroll-use')).toBeVisible();
  await expect(page.getByTestId('reroll-keep')).toBeVisible();
  await page.screenshot({ path: info.outputPath('reroll.png') });
  await page.screenshot({ path: `test-results/reroll-${info.project.name}.png` });

  // Keep it: the next failed roll is asked about (the prompt stays, with its two answers).
  await page.getByTestId('reroll-keep').click();
  await expect(page.getByTestId('reroll-use')).toBeVisible();
  await expect(page.getByTestId('reroll-keep')).toBeVisible();
  await page.getByTestId('reroll-use').click();
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
  // Any other reaction the game offers meanwhile (Covering Fire, say) is skipped.
  const skip = page.getByTestId('reaction').getByRole('button', { name: 'Skip', exact: true });
  await expect(async () => {
    if (await keep.isVisible()) await keep.click();
    else if (await skip.isVisible()) await skip.click();
    await log.click({ timeout: 500 });
  }).toPass({ timeout: 90_000, intervals: [150] });
  await expect(page.getByTestId('log-list')).toContainText('Glamourweave: re-rolled a failed');
});
