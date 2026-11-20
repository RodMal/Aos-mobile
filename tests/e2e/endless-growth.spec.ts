/** Sylvaneth: Endless Growth and Aspect of Heartwood are the player's choice at the end of a turn (M4n). */
import { expect, test, type Page } from '@playwright/test';
import { RULES_VERSION } from '../../src/ui/game/rulesVersion.js';

/** Plays the computer on both sides until the human (player 0) is asked about Endless Growth. */
async function findGrowth(page: Page) {
  await page.goto('./?e2e=1&seed=5&side=0&fast=1&new=1');
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
        if (d.kind === 'endlessGrowth' && d.player === 0) return { seed, actions };
        const action = chooseAction(engine, state);
        actions.push(action);
        state = engine.apply(state, action).state;
      }
    }
    return null;
  });
}

test('Endless Growth: the player chooses Aspect of Heartwood for a target', async ({
  page,
}, info) => {
  const found = await findGrowth(page);
  expect(found).not.toBeNull();
  const record = JSON.stringify({
    v: 1,
    rules: RULES_VERSION,
    seed: found!.seed,
    humanPlayer: 0,
    actions: found!.actions,
  });
  await page.addInitScript((r) => localStorage.setItem('aos-mobile:game', r), record);
  await page.goto(`./?seed=${found!.seed}&side=0&fast=1`);
  const prompt = page.getByTestId('endless-growth-aspect');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Aspect of Heartwood');
  await expect(prompt.getByTestId('growth-d6')).toBeVisible();
  await expect(prompt.getByTestId('growth-normal')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`endless-growth-${info.project.name}.png`) });
  const before = await prompt.innerText();
  await prompt.getByTestId('growth-normal').click();
  // The next question (another target, or the heal-or-return choice) or the game moves on.
  await expect
    .poll(async () => {
      const aspect = page.getByTestId('endless-growth-aspect');
      return (await aspect.count()) === 0 || (await aspect.innerText()) !== before;
    })
    .toBe(true);
});
