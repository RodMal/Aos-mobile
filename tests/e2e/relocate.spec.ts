/** Sylvaneth: Huntmaster's Strike is offered at the end of a turn and starts a set-up (M4g). */
import { expect, test } from '@playwright/test';
import { openPosition } from './positions.js';

test("Huntmaster's Strike: offered at the end of the turn, then the unit is set up again", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await openPosition(page, 1, (_engine, _s, d) =>
    d.kind === 'reaction' &&
    d.player === 0 &&
    d.options.some((o) => o.ability === 'huntmastersStrike')
      ? 'huntmaster'
      : null,
  );
  const prompt = page.getByTestId('reaction');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('turn is ending');
  const use = page.getByTestId('huntmasters-strike');
  await expect(use).toBeVisible();
  await page.screenshot({ path: `test-results/huntmaster-${info.project.name}.png` });
  await use.click();
  // The unit is now being set up again; skipping leaves it where it stands.
  const panel = page.getByTestId('place-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Set up again');
  await page.screenshot({ path: `test-results/huntmaster-place-${info.project.name}.png` });
});
