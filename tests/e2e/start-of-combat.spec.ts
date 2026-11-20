/** Groundshaker, Venomite Swarm and Ark of Sotek are offered in the start-of-combat window (R14). */
import { expect, test } from '@playwright/test';
import { openPosition } from './positions.js';

test('the start-of-combat window offers Groundshaker, Venomite Swarm or Ark of Sotek before any fighter is picked', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await openPosition(page, 1, (_engine, _s, d) =>
    d.kind === 'reaction' &&
    d.player === 0 &&
    d.trigger === 'start:combat' &&
    d.options.some(
      (o) =>
        o.ability === 'groundshaker' || o.ability === 'venomiteSwarm' || o.ability === 'arkOfSotek',
    )
      ? 'window'
      : null,
  );
  const prompt = page.getByTestId('reaction');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('before any unit fights');
  const use = prompt
    .locator(
      '[data-testid="groundshaker"], [data-testid="venomite-swarm"], [data-testid="ark-of-sotek-use"]',
    )
    .first();
  if ((await use.count()) === 0) {
    // The Ark picks its targets first.
    await prompt.locator('[data-testid="ark-of-sotek"] .chip').first().click();
  }
  await page.screenshot({ path: `test-results/start-of-combat-${info.project.name}.png` });
  await prompt.locator('button', { hasText: /Free$/ }).first().click();
  // Resolved before any fighter is picked: no Groundshaker button is left in the window.
  await expect(page.getByTestId('groundshaker')).toHaveCount(0);
});
