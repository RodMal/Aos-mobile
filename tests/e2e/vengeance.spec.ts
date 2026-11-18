/** Seraphon (Sunclaw Starhost): Vengeance of Azyr is asked at the end of a turn. */
import { expect, test, type Page } from '@playwright/test';

/** Plays the computer on both sides until the Seraphon player is asked Vengeance of Azyr. */
async function findVengeance(page: Page) {
  await page.goto('./?e2e=1&seed=5&side=1&fast=1&new=1');
  await page.waitForFunction(() => !!(window as unknown as { __aosTest?: unknown }).__aosTest);
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { engine, chooseAction } = (window as unknown as { __aosTest: any }).__aosTest;
    for (let seed = 1; seed < 40; seed++) {
      let state = engine.newGame(seed);
      const actions: unknown[] = [];
      for (let i = 0; i < 4000; i++) {
        const d = engine.decision(state);
        if (!d) break;
        if (d.kind === 'vengeance' && d.player === 1 && d.stage === 'pick') {
          return { seed, actions };
        }
        const action = chooseAction(engine, state);
        actions.push(action);
        state = engine.apply(state, action).state;
      }
    }
    return null;
  });
}

async function loadAt(page: Page, found: { seed: number; actions: unknown[] }) {
  const record = JSON.stringify({ v: 1, seed: found.seed, humanPlayer: 1, actions: found.actions });
  await page.addInitScript((r) => localStorage.setItem('aos-mobile:game', r), record);
  await page.goto(`./?seed=${found.seed}&side=1&fast=1`);
}

test('Vengeance of Azyr: pick units at the end of a turn, then each piles in', async ({
  page,
}, info) => {
  const found = await findVengeance(page);
  expect(found).not.toBeNull();
  await loadAt(page, found!);
  const prompt = page.getByTestId('vengeance');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Vengeance of Azyr');
  await expect(prompt.locator('[data-vengeance]').first()).toBeVisible();
  await expect(prompt.getByTestId('vengeance-use')).toBeDisabled();
  await page.screenshot({ path: info.outputPath(`vengeance-${info.project.name}.png`) });
  await prompt.locator('[data-vengeance]').first().click();
  await expect(prompt.getByTestId('vengeance-use')).toBeEnabled();
  await prompt.getByTestId('vengeance-use').click();
  await expect(prompt).toBeHidden();
  // The first picked unit now makes its pile-in move on the board.
  await expect(page.getByTestId('decision')).toContainText(/pile/i);
  await page.screenshot({ path: info.outputPath(`vengeance-pile-in-${info.project.name}.png`) });
});

test('Vengeance of Azyr: skip', async ({ page }) => {
  const found = await findVengeance(page);
  expect(found).not.toBeNull();
  await loadAt(page, found!);
  const prompt = page.getByTestId('vengeance');
  await expect(prompt).toBeVisible();
  await prompt.getByTestId('vengeance-skip').click();
  await expect(prompt).toBeHidden();
});
