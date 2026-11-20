/**
 * M4j through the touch UI: Hidden Hunters sets a Hunters of Huanchi unit up in reserve in
 * ambush while deploying, and Chameleon Ambush sets it up in the owner's movement phase.
 */
import { expect, test } from '@playwright/test';
import {
  endPhaseUntil,
  minimalPlayerStep,
  selectFromRoster,
  startDeploy,
  usable,
} from './helpers.js';

const HUNTERS = '1:8';

test('Hidden Hunters, then Chameleon Ambush', async ({ page }, info) => {
  test.setTimeout(300_000);
  await startDeploy(page, 'seed=5&side=1&new=1&deploy=1&fast=1');
  const confirm = page.getByTestId('place-confirm');
  const hidden = page.getByTestId('hidden-hunters');
  const venomites = page.getByTestId('venomites');
  // Deploy until the first Hunters unit is the one to place.
  for (let i = 0; i < 60 && !(await hidden.isVisible()); i++) {
    if (await usable(venomites.locator('[data-testid="venomites-left"]'))) {
      await page.getByTestId('venomites-left').click();
    } else if (await confirm.isVisible()) {
      if (await confirm.isDisabled()) await page.getByRole('button', { name: 'Auto' }).click();
      await confirm.click();
    }
    await page.waitForTimeout(300);
  }
  await expect(hidden).toBeVisible();
  await page.screenshot({ path: info.outputPath(`hidden-hunters-${info.project.name}.png`) });
  await hidden.click();

  // Deploy what is left, then play on (ending every phase) until the owner's movement phase.
  const phase = page.getByTestId('phase').locator('[aria-current="step"]');
  const round = page.getByTestId('round');
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) {
    if (await usable(page.getByTestId('venomites-left'))) {
      await page.getByTestId('venomites-left').click();
      continue;
    }
    if (await confirm.isVisible()) {
      if (await confirm.isDisabled()) await page.getByRole('button', { name: 'Auto' }).click();
      await confirm.click();
      continue;
    }
    const roundNow = Number(
      /Round (\d)/.exec((await round.textContent().catch(() => '')) ?? '')?.[1] ?? 0,
    );
    const mine = /Your turn/i.test(
      (await page
        .getByTestId('topbar')
        .textContent()
        .catch(() => '')) ?? '',
    );
    const phaseNow = (await phase.textContent().catch(() => '')) ?? '';
    // No prompt may stand in the way: a confirmation or the turn summary covers the buttons.
    const blocked =
      (await page.getByTestId('confirm').isVisible()) ||
      (await page.getByTestId('turn-summary-close').isVisible());
    if (roundNow >= 2 && roundNow <= 3 && mine && !blocked) {
      if (/Movement/i.test(phaseNow) && (await usable(page.getByTestId('end-phase')))) {
        ready = true;
        break;
      }
      // Our own turn in round 2 or 3: end phases one at a time, waiting for each to change.
      if (!/Movement/i.test(phaseNow) && (await usable(page.getByTestId('end-phase')))) {
        await endPhaseUntil(page, /Movement/);
        continue;
      }
    }
    if ((await minimalPlayerStep(page)) === null) await page.waitForTimeout(150);
  }
  expect(ready).toBe(true);

  // The unit waits in ambush: the roster says so and the unit card offers Chameleon Ambush.
  await selectFromRoster(page, HUNTERS);
  await expect(page.getByTestId('unit-panel')).toContainText('ambush');
  await page.screenshot({ path: info.outputPath(`ambush-card-${info.project.name}.png`) });
  await page.locator('[data-ability="4a89-1c50-df0e-4b2b"]').click();
  await page.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('place-panel')).toBeVisible();
  if (await page.getByRole('button', { name: 'Auto' }).isVisible()) {
    await page.getByRole('button', { name: 'Auto' }).click();
  }
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: info.outputPath(`chameleon-${info.project.name}.png`) });
  await confirm.click();
  await expect(page.getByTestId('place-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText(/is set up again/);
});
