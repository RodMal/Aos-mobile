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
  // The Ark picks its targets first: its button is there but disabled until one is chosen.
  const ark = prompt.getByTestId('ark-of-sotek-use');
  if ((await ark.count()) > 0 && (await ark.isDisabled())) {
    await prompt.locator('[data-testid="ark-of-sotek"] .chip').first().click();
  }
  await page.screenshot({ path: `test-results/start-of-combat-${info.project.name}.png` });
  const clicked = prompt.locator('button', { hasText: /Free$/ }).first();
  const label = (await clicked.textContent()) ?? '';
  await clicked.click();
  // Resolved before any fighter is picked: that button is no longer in the window.
  await expect(page.getByTestId('reaction').locator('button', { hasText: label })).toHaveCount(0);
});
