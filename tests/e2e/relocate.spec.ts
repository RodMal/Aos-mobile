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

test('Shadowcreep: the place panel lists the limits and the distance to the nearest enemy (B2)', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const pos = await openPosition(page, 1, (engine, s, d) => {
    if (d.kind !== 'main' || d.player !== 0 || d.phase !== 'movement') return null;
    const unit = Object.values(s.units).find(
      (u) =>
        u.owner === 0 &&
        engine
          .unitOptions(s, u.id)
          .some((o) => o.t === 'ability' && o.abilityId === '76b2-ce61-8aec-f6c1'),
    );
    return unit ? unit.id : null;
  });
  await page.locator(`[data-ready-unit="${pos.note}"]`).first().click();
  await page.getByRole('button', { name: /Shadowcreep/ }).click();
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  const panel = page.getByTestId('place-panel');
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText('anywhere legal');
  const limits = panel.getByTestId('setup-limits');
  await expect(limits).toContainText('Wholly within 3" of a terrain feature');
  await expect(limits).toContainText('More than 9" from all enemy units');
  await expect(panel.getByTestId('setup-nearest')).toContainText(/Nearest enemy: .+, [\d.]+" away/);
  await expect(page.getByTestId('enemy-ruler')).toBeAttached();
  await page.screenshot({ path: `test-results/shadowcreep-place-${info.project.name}.png` });
});
