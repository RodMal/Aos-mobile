/** Scything Blade in the enemy's movement phase (M4o): offered to its owner like Redeploy. */
import { expect, test } from '@playwright/test';
import { openPosition } from './positions.js';

test('the Pendulum owner is offered Scything Blade when the enemy ends its movement phase, and moves it', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  await openPosition(
    page,
    1,
    (_engine, _s, d) =>
      d.kind === 'reaction' &&
      d.player === 0 &&
      d.trigger === 'phase:movement' &&
      d.options.some((o) => o.ability === 'scythingBlade')
        ? 'scything'
        : null,
    { seeds: 150 },
  );
  const prompt = page.getByTestId('reaction');
  await expect(prompt).toBeVisible();
  const blade = prompt.getByTestId('scything-blade');
  await expect(blade).toContainText('Scything Blade');
  await page.screenshot({ path: `test-results/scything-blade-${info.project.name}.png` });
  await blade.click();
  // The move is placed through the place panel like any other move.
  await expect(page.getByTestId('place-panel')).toBeVisible();
  await expect(page.getByTestId('place-panel')).toContainText('Move');
});
