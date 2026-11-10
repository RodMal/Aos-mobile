/**
 * A whole game through the UI against the real NPC. The "player" here does the minimum a
 * person must: ends their own phases, answers the priority roll, skips reactions, and when
 * the opponent attacks picks a unit, fights back and rolls. It proves that every decision
 * the engine can raise during a game has a way through the touch UI to the result screen.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { startGame } from './helpers.js';

const usable = async (l: Locator): Promise<boolean> =>
  (await l.isVisible().catch(() => false)) && (await l.isEnabled().catch(() => false));

/** One step of the minimal player: clicks the first control that applies. */
async function step(page: Page): Promise<string | null> {
  const controls: [string, Locator][] = [
    ['confirm', page.getByTestId('confirm-ok')],
    ['priority', page.getByRole('button', { name: 'Take first turn' })],
    ['skip reaction', page.getByRole('button', { name: 'Skip', exact: true })],
    ['roll', page.getByTestId('roll-attacks')],
    ['confirm placement', page.getByTestId('place-confirm')],
    ['cancel placement', page.getByTestId('place-cancel')],
    ['fight', page.locator('[data-action="fight"]')],
    ['end phase', page.getByTestId('end-phase')],
    ['pick unit', page.locator('[data-testid="ready-units"] .chip').first()],
  ];
  for (const [name, control] of controls) {
    if (await usable(control)) {
      await control.click({ timeout: 3000 });
      return name;
    }
  }
  return null;
}

test('a full five-round game can be played to the result screen', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 'seed=3&side=0&fast=1&new=1');
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
