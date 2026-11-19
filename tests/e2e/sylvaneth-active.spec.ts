/**
 * Sylvaneth activated abilities (M4i) through the touch UI: Wyldwood Revenants is offered on an
 * unmodified chanting roll of 1, and Lifebloom is an ability of a damaged Alarielle in the hero
 * phase.
 */
import { expect, test, type Page } from '@playwright/test';
import { RULES_VERSION } from '../../src/ui/game/rulesVersion.js';
import { selectFromRoster } from './helpers.js';

interface Found {
  seed: number;
  actions: unknown[];
  unit: string;
  ability: string;
  target?: string;
}

/**
 * The computer plays both sides until the Sylvaneth player (side 0) has a hero phase in which
 * a prayer of the Warsong Revenant is rolled as 1 (the reaction is then offered), or, for
 * Lifebloom, in which Alarielle is damaged.
 */
async function find(page: Page, what: 'chant' | 'lifebloom'): Promise<Found> {
  await page.goto('./?e2e=1&seed=5&side=0&fast=1&new=1');
  await page.waitForFunction(() => !!(window as unknown as { __aosTest?: unknown }).__aosTest);
  const found = await page.evaluate((kind) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { engine, chooseAction } = (window as unknown as { __aosTest: any }).__aosTest;
    for (let seed = 5; seed < 45; seed++) {
      let state = engine.newGame(seed);
      const actions: unknown[] = [];
      for (let i = 0; i < 4000; i++) {
        const d = engine.decision(state);
        if (!d) break;
        if (d.kind === 'main' && d.player === 0 && d.phase === 'hero') {
          const unit = Object.values(state.units).find(
            (u: any) =>
              u.owner === 0 &&
              u.status === 'battlefield' &&
              u.name === (kind === 'chant' ? 'Warsong Revenant' : 'Alarielle the Everqueen'),
          ) as any;
          if (unit && kind === 'lifebloom') {
            const opt = engine
              .unitOptions(state, unit.id)
              .find((o: any) => o.t === 'ability' && o.name === 'Lifebloom');
            if (opt) return { seed, actions, unit: unit.id, ability: opt.abilityId };
          }
          if (unit && kind === 'chant') {
            const prayer = engine
              .unitOptions(state, unit.id)
              .find((o: any) => o.t === 'ability' && o.kind === 'prayer');
            if (prayer) {
              const after = engine.apply(state, {
                t: 'ability',
                unit: unit.id,
                abilityId: prayer.abilityId,
                target: prayer.targets[0],
              }).state;
              const next = engine.decision(after);
              if (next?.kind === 'reaction' && next.trigger.startsWith('chant:')) {
                return {
                  seed,
                  actions,
                  unit: unit.id,
                  ability: prayer.abilityId,
                  target: prayer.targets[0],
                };
              }
            }
          }
        }
        const action = chooseAction(engine, state);
        actions.push(action);
        state = engine.apply(state, action).state;
      }
    }
    return null;
  }, what);
  expect(found).not.toBeNull();
  return found as Found;
}

async function resume(page: Page, found: Found): Promise<void> {
  const record = JSON.stringify({
    v: 1,
    rules: RULES_VERSION,
    seed: found.seed,
    humanPlayer: 0,
    actions: found.actions,
  });
  await page.addInitScript((r) => localStorage.setItem('aos-mobile:game', r), record);
  await page.goto(`./?seed=${found.seed}&side=0&fast=1`);
}

test('Wyldwood Revenants is offered on a chanting roll of 1 and re-rolls it', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const found = await find(page, 'chant');
  await resume(page, found);

  await selectFromRoster(page, found.unit);
  await page.locator(`[data-ability="${found.ability}"]`).click();
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toBeVisible();
  if (found.target) await panel.locator(`[data-target="${found.target}"]`).click();
  await page.getByTestId('ability-confirm').click();

  await expect(page.getByTestId('reaction')).toBeVisible();
  await expect(page.getByTestId('reaction-text')).toContainText('rolled a 1 chanting');
  const reroll = page.getByTestId('wyldwood-revenants');
  await expect(reroll).toBeVisible();
  await page.screenshot({ path: info.outputPath(`revenants-${info.project.name}.png`) });
  await reroll.click();
  await expect(page.getByTestId('reaction')).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  const log = (await page.getByTestId('log-list').textContent()) ?? '';
  expect(log).toMatch(/Wyldwood Revenants/);
});

test('Lifebloom heals Alarielle from the ability panel', async ({ page }, info) => {
  test.setTimeout(240_000);
  const found = await find(page, 'lifebloom');
  await resume(page, found);

  await selectFromRoster(page, found.unit);
  await page.locator(`[data-ability="${found.ability}"]`).click();
  await expect(page.getByTestId('ability-panel')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`lifebloom-${info.project.name}.png`) });
  await page.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('ability-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText('Lifebloom');
});
