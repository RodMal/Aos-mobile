/**
 * Manifestation movement abilities: when the move passes across more units than the ability may
 * hit, the player picks the targets (M4p, I115). A game this deep is too rare to find by playing
 * (the NPC seldom crosses four units), so the position is set up by hand through the e2e game
 * hook: a start-of-game state with the sweep question on top of the stack.
 */
import { expect, test } from '@playwright/test';

test('after a sweep passes across more units than it may hit, the player picks the targets', async ({
  page,
}, info) => {
  await page.goto('./?e2e=1&seed=1&side=0&fast=1&new=1');
  await page.waitForFunction(() => !!(window as unknown as { __aosTest?: unknown }).__aosTest);
  const picked = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { game } = (window as unknown as { __aosTest: any }).__aosTest;
    const session = game.getState().session;
    const state = structuredClone(session.state);
    const mine = Object.values(state.units).find(
      (u: any) => u.owner === 0 && u.status === 'battlefield',
    ) as any;
    const enemies = Object.values(state.units)
      .filter((u: any) => u.owner === 1 && u.status === 'battlefield')
      .slice(0, 4)
      .map((u: any) => u.id);
    state.stack = [
      { t: 'sweep', player: 0, unit: mine.id, kind: 'scything', units: enemies, max: 3 },
    ];
    game.setState({ session: { ...session, state } });
    return enemies;
  });
  expect(picked).toHaveLength(4);
  const prompt = page.getByTestId('sweep-targets');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Scything Blade');
  const confirm = prompt.getByTestId('sweep-confirm');
  await expect(confirm).toBeDisabled();
  await page.screenshot({ path: info.outputPath(`sweep-pick-${info.project.name}.png`) });
  // Up to 3 may be picked: a fourth tap is ignored.
  for (const id of picked) await prompt.locator(`[data-sweep="${id}"]`).click();
  await expect(prompt.locator('[aria-pressed="true"]')).toHaveCount(3);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(prompt).toBeHidden();
  // The three rolls are in the log.
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText('Scything Blade');
});
