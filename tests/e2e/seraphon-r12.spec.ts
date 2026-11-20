/**
 * R12 through the touch UI: Scry the Stars asks which units get the Ward after the dice are
 * rolled, Star-venom is offered after Covering Fire in the enemy turn, and the Venomites token is
 * placed when the Sunblood Pack is deployed.
 */
import { expect, test, type Page } from '@playwright/test';
import { RULES_VERSION } from '../../src/ui/game/rulesVersion.js';
import { selectFromRoster, startDeploy } from './helpers.js';

interface Found {
  seed: number;
  actions: unknown[];
  /** The action that leads to the prompt (made by the human in the test). */
  unit: string;
  ability?: string;
  command?: string;
}

/** Runs the computer on both sides, looking for a state where `probe` finds the prompt. */
async function find(page: Page, kind: 'scry' | 'venom'): Promise<Found> {
  await page.goto('./?e2e=1&seed=5&side=1&fast=1&new=1');
  await page.waitForFunction(() => !!(window as unknown as { __aosTest?: unknown }).__aosTest);
  const found = await page.evaluate((what) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { engine, chooseAction } = (window as unknown as { __aosTest: any }).__aosTest;
    const SCRY = 'b8a5-8e24-ad08-d213';
    for (let seed = 5; seed < 80; seed++) {
      let state = engine.newGame(seed);
      const actions: unknown[] = [];
      for (let i = 0; i < 4000; i++) {
        const d = engine.decision(state);
        if (!d) break;
        if (what === 'scry' && d.kind === 'main' && d.player === 1 && d.phase === 'hero') {
          const starseer = Object.values(state.units).find(
            (u: any) => u.owner === 1 && u.name === 'Skink Starseer' && u.status === 'battlefield',
          ) as any;
          const opt = starseer
            ? engine
                .unitOptions(state, starseer.id)
                .find((o: any) => o.t === 'ability' && o.abilityId === SCRY)
            : null;
          if (opt) {
            const after = engine.apply(state, {
              t: 'ability',
              unit: starseer.id,
              abilityId: SCRY,
            }).state;
            if (engine.decision(after)?.kind === 'scry') {
              return { seed, actions, unit: starseer.id, ability: SCRY };
            }
          }
        }
        if (what === 'venom' && d.kind === 'reaction' && d.player === 1) {
          const cf = d.options.find((o: any) => o.command === 'coveringFire');
          if (cf) {
            const after = engine.apply(state, {
              t: 'command',
              command: 'coveringFire',
              unit: cf.unit,
            }).state;
            const next = engine.decision(after);
            if (
              next?.kind === 'reaction' &&
              next.options.some((o: any) => o.ability === 'starVenom')
            ) {
              return { seed, actions, unit: cf.unit, command: 'coveringFire' };
            }
          }
        }
        const action = chooseAction(engine, state);
        actions.push(action);
        state = engine.apply(state, action).state;
      }
    }
    return null;
  }, kind);
  expect(found).not.toBeNull();
  return found as Found;
}

async function load(page: Page, found: Found): Promise<void> {
  const record = JSON.stringify({
    v: 1,
    rules: RULES_VERSION,
    seed: found.seed,
    humanPlayer: 1,
    actions: found.actions,
  });
  await page.addInitScript((r) => localStorage.setItem('aos-mobile:game', r), record);
  await page.goto(`./?seed=${found.seed}&side=1&fast=1`);
}

test('Scry the Stars rolls first, then asks which units get the Ward', async ({ page }, info) => {
  test.setTimeout(240_000);
  const found = await find(page, 'scry');
  await load(page, found);
  await selectFromRoster(page, found.unit);
  await page.locator(`[data-ability="${found.ability}"]`).click();
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toBeVisible();
  // No target to pick: the units are asked for after the roll.
  await page.getByTestId('ability-confirm').click();
  const prompt = page.getByTestId('scry-stars');
  await expect(prompt).toBeVisible();
  await page.screenshot({ path: info.outputPath(`scry-${info.project.name}.png`) });
  await prompt.locator('[data-scry]').first().click();
  await page.getByTestId('scry-confirm').click();
  await expect(prompt).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText('Ward (5+)');
});

test('the Venomites token is placed when the Sunblood Pack is deployed', async ({ page }, info) => {
  test.setTimeout(240_000);
  await startDeploy(page, 'seed=5&side=1&new=1&deploy=1&fast=1');
  const prompt = page.getByTestId('venomites');
  const confirm = page.getByTestId('place-confirm');
  for (let i = 0; i < 40 && !(await prompt.isVisible()); i++) {
    if (await confirm.isVisible()) {
      if (await confirm.isDisabled()) await page.getByRole('button', { name: 'Auto' }).click();
      await confirm.click();
    }
    await page.waitForTimeout(400);
  }
  await expect(prompt).toBeVisible();
  await page.screenshot({ path: info.outputPath(`venomites-${info.project.name}.png`) });
  await page.getByTestId('venomites-left').click();
  await expect(prompt).toBeHidden();
  await expect(page.getByTestId('venomites-token').first()).toBeAttached();
});

test('Star-venom is offered after Covering Fire in the enemy turn', async ({ page }, info) => {
  test.setTimeout(240_000);
  const found = await find(page, 'venom');
  await load(page, found);
  // The replay reaches the Covering Fire offer; take it and look for Star-venom.
  const reaction = page.getByTestId('reaction');
  await expect(reaction).toBeVisible({ timeout: 20_000 });
  await reaction.getByRole('button', { name: /Covering Fire/ }).click();
  const venom = page.getByTestId('star-venom').first();
  await expect(venom).toBeVisible();
  await page.screenshot({ path: info.outputPath(`star-venom-${info.project.name}.png`) });
  await venom.click();
  await expect(venom).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText(/Star-venom/);
});
