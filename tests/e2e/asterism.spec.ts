/** Seraphon: The Great Plan is asked before round 1, and Sotek's +2 Move shows on the card. */
import { expect, test } from '@playwright/test';
import { RULES_VERSION } from '../../src/ui/game/rulesVersion.js';
import { selectFromRoster } from './helpers.js';

test('The Great Plan: pick an Asterism; Sotek the Deliverer adds 2 to the Move shown', async ({
  page,
}, info) => {
  await page.goto('./?seed=5&side=1&fast=1&new=1');
  const prompt = page.getByTestId('asterism');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('The Great Plan');
  await expect(prompt.locator('[data-asterism]')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath(`great-plan-${info.project.name}.png`) });
  await prompt.locator('[data-asterism="6960-effd-2a46-d7d4"]').click();
  await expect(prompt).toBeHidden();
  // The fugitive, the first turn, a Place of Power and Kroak's Unbind (offered for every enemy
  // spell, from anywhere) may follow; answer each until the board is free.
  const popup = page.locator('.modal-wrap');
  await page.waitForTimeout(800);
  for (let i = 0; i < 30 && (await popup.isVisible().catch(() => false)); i++) {
    if (
      await page
        .locator('[data-fugitive]')
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await page.locator('[data-fugitive]').first().click();
    } else if (
      await page
        .getByTestId('priority')
        .isVisible()
        .catch(() => false)
    ) {
      await page.getByTestId('priority').getByRole('button', { name: 'Take first turn' }).click();
    } else {
      await popup.getByRole('button', { name: /^(Pass|Skip)$/ }).click();
    }
    await page.waitForTimeout(500);
  }
  // Saurus Warriors have Move 5": 7" once Sotek is prophesied.
  await selectFromRoster(page, '1:5');
  await expect(page.getByTestId('stat-line')).toContainText('7"');
});

test('Further the Great Plan: pick a key whose condition is met, then the Asterism to prophesy', async ({
  page,
}, info) => {
  await page.goto('./?e2e=1&seed=5&side=1&fast=1&new=1');
  await page.waitForFunction(() => !!(window as unknown as { __aosTest?: unknown }).__aosTest);
  // The computer plays both sides (the Seraphon player prophesies Tepok the Seer in round 1)
  // until round 2 asks the Seraphon player; the game is then saved with the human as Seraphon.
  const found = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { engine, chooseAction } = (window as unknown as { __aosTest: any }).__aosTest;
    for (let seed = 5; seed < 25; seed++) {
      let state = engine.newGame(seed);
      const actions: unknown[] = [];
      for (let i = 0; i < 4000; i++) {
        const d = engine.decision(state);
        if (!d) break;
        if (d.kind === 'asterism' && d.stage === 'further') {
          return { seed, actions };
        }
        const action =
          d.kind === 'asterism' && d.stage === 'great'
            ? { t: 'choose', value: '90ae-3432-b3f3-4727' }
            : chooseAction(engine, state);
        actions.push(action);
        state = engine.apply(state, action).state;
      }
    }
    return null;
  });
  expect(found).not.toBeNull();
  // Set the save on the next load (the first page may still write its own save).
  const record = JSON.stringify({
    v: 1,
    rules: RULES_VERSION,
    seed: found!.seed,
    humanPlayer: 1,
    actions: found!.actions,
  });
  await page.addInitScript((r) => localStorage.setItem('aos-mobile:game', r), record);
  await page.goto(`./?seed=${found!.seed}&side=1&fast=1`);
  const prompt = page.getByTestId('asterism');
  await expect(prompt).toContainText('Further the Great Plan');
  await page.screenshot({ path: info.outputPath(`further-key-${info.project.name}.png`) });
  await prompt.locator('[data-key]:not([disabled])').first().click();
  await expect(prompt.locator('[data-asterism]').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath(`further-new-${info.project.name}.png`) });
  await prompt.locator('[data-asterism]').first().click();
  await expect(prompt).toBeHidden();
});
