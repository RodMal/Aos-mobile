/**
 * Sylvaneth (R10): Merciless Ambush asks for a confirmation (with a look at the map) before its
 * dice are rolled; cancelling costs nothing.
 */
import { expect, test } from '@playwright/test';
import { openPosition } from './positions.js';

test('Merciless Ambush: confirm or cancel before the charge dice are rolled', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const pos = await openPosition(page, 1, (engine, s, d) => {
    if (d.kind !== 'main' || d.player !== 0 || d.phase !== 'charge') return null;
    const unit = Object.values(s.units).find(
      (u) =>
        u.owner === 0 &&
        engine
          .unitOptions(s, u.id)
          .some((o) => o.t === 'command' && o.command === 'mercilessAmbush'),
    );
    return unit ? unit.id : null;
  });
  await page.locator(`[data-ready-unit="${pos.note}"]`).first().click();
  await page.getByRole('button', { name: /Merciless Ambush/ }).click();
  const prompt = page.getByTestId('reaction');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('confirm');
  await expect(page.getByTestId('merciless-ambush-confirm')).toBeVisible();
  await expect(page.getByTestId('reaction-see-map')).toBeVisible();
  await page.screenshot({ path: `test-results/ambush-confirm-${info.project.name}.png` });
  // Cancel: nothing was paid or rolled, and the command is still on offer.
  await prompt.getByRole('button', { name: 'Skip' }).click();
  await expect(prompt).toBeHidden();
  await expect(page.getByRole('button', { name: /Merciless Ambush/ })).toBeVisible();
});
