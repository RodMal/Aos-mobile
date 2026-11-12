/**
 * A whole game through the UI against the real NPC. The "player" here does the minimum a
 * person must: ends their own phases, answers the priority roll, skips reactions, and when
 * the opponent attacks picks a unit, fights back and rolls. It proves that every decision
 * the engine can raise during a game has a way through the touch UI to the result screen.
 */
import { expect, test } from '@playwright/test';
import { isDesktop, minimalPlayerStep as step, startGame, usable } from './helpers.js';

test('a full five-round game can be played to the result screen', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 'seed=4&side=0&fast=1&new=1');
  const result = page.getByRole('heading', { name: /^(Victory|Defeat|A draw)$/ });
  const used = new Set<string>();
  let idle = 0;
  for (let i = 0; i < 4000 && !(await result.isVisible()); i++) {
    const did = await step(page);
    if (did) {
      used.add(did);
      idle = 0;
    } else {
      // The opponent is thinking or the log is catching up.
      await page.waitForTimeout(100);
      if (++idle > 100) throw new Error('the game stopped with nothing for the player to do');
    }
  }

  await expect(result).toBeVisible();
  await expect(page.getByTestId('round')).toContainText('Round 5');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
  // The opponent attacked, so the player was asked to react and to fight back.
  expect([...used]).toEqual(
    expect.arrayContaining([
      'end phase',
      'priority',
      'skip reaction',
      'pick unit',
      'fight',
      'roll',
    ]),
  );
  expect(errors).toEqual([]);
});

test('a charge can be declared, placed in contact and fought', async ({ page }) => {
  test.skip(isDesktop(), 'the full game above already runs on desktop; the charge flow is clicks');
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 'seed=4&side=0&fast=1&new=1');
  const phase = page.getByTestId('phase').locator('[aria-current="step"]');
  const chips = page.locator('[data-testid="ready-units"] .chip');
  let charged = false;
  let foughtAfterCharge = false;
  let idle = 0;
  for (let i = 0; i < 3000 && !foughtAfterCharge; i++) {
    const myChargePhase =
      (await page.getByTestId('turn').textContent()) === 'Your turn' &&
      /charge/i.test((await phase.textContent()) ?? '');
    if (!charged && myChargePhase) {
      const chargeBtn = page.locator('[data-action="charge"]');
      if (await usable(chargeBtn)) {
        await chargeBtn.click();
        if (await page.getByTestId('place-panel').isVisible()) {
          const confirmBtn = page.getByTestId('place-confirm');
          if (await confirmBtn.isEnabled()) {
            await confirmBtn.click();
            charged = true;
            continue;
          }
          // The charge roll succeeded but no legal placement was found (e.g. unit is screened by allies). Give up.
          const cancelBtn = page.getByTestId('place-cancel');
          if (await usable(cancelBtn)) {
            await cancelBtn.click();
            continue;
          }
        } else {
          const close = page.getByTestId('unit-panel').getByRole('button', { name: 'Close' });
          if (await usable(close)) await close.click();
          continue;
        }
      }
      const close = page.getByTestId('unit-panel').getByRole('button', { name: 'Close' });
      if (await usable(close)) {
        await close.click();
      } else {
        const count = await chips.count();
        let clicked = false;
        for (let c = 0; c < count; c++) {
          const chip = chips.nth(c);
          if (await usable(chip)) {
            await chip.click();
            if (await usable(chargeBtn)) {
              clicked = true;
              break;
            }
            const cl = page.getByTestId('unit-panel').getByRole('button', { name: 'Close' });
            if (await usable(cl)) await cl.click();
          }
        }
        if (clicked) continue;
      }
    }
    const did = await step(page);
    if (did) idle = 0;
    else {
      await page.waitForTimeout(100);
      if (++idle > 100) throw new Error('the game stopped with nothing for the player to do');
    }
    if (charged && did === 'roll') foughtAfterCharge = true;
  }

  expect(charged).toBe(true);
  expect(foughtAfterCharge).toBe(true);
  expect(errors).toEqual([]);
});
