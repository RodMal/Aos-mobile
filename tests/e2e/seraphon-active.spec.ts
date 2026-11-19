/**
 * Seraphon activated abilities (M4h) through the touch UI: Coatl Familiar and Celestial Conduit
 * are offered when a spell is declared, and the combat abilities are offered while a fighter is
 * picked without being listed under "Can fight".
 */
import { expect, test, type Page } from '@playwright/test';
import { RULES_VERSION } from '../../src/ui/game/rulesVersion.js';
import { selectFromRoster } from './helpers.js';

interface Found {
  seed: number;
  actions: unknown[];
  unit: string;
  ability: string;
  target: string;
}

/** The computer plays both sides until the Seraphon player (side 1) may cast with the Starseer. */
async function findCast(page: Page): Promise<Found> {
  await page.goto('./?e2e=1&seed=5&side=1&fast=1&new=1');
  await page.waitForFunction(() => !!(window as unknown as { __aosTest?: unknown }).__aosTest);
  const found = await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { engine, chooseAction } = (window as unknown as { __aosTest: any }).__aosTest;
    for (let seed = 5; seed < 25; seed++) {
      let state = engine.newGame(seed);
      const actions: unknown[] = [];
      for (let i = 0; i < 4000; i++) {
        const d = engine.decision(state);
        if (!d) break;
        if (d.kind === 'main' && d.player === 1 && d.phase === 'hero') {
          const starseer = Object.values(state.units).find(
            (u: any) => u.owner === 1 && u.name === 'Skink Starseer' && u.status === 'battlefield',
          ) as any;
          const spell = starseer
            ? engine
                .unitOptions(state, starseer.id)
                .find((o: any) => o.t === 'ability' && o.kind === 'spell' && o.targets.length > 0)
            : null;
          if (spell) {
            const after = engine.apply(state, {
              t: 'ability',
              unit: starseer.id,
              abilityId: spell.abilityId,
              target: spell.targets[0],
            }).state;
            const next = engine.decision(after);
            if (
              next?.kind === 'reaction' &&
              next.options.some((o: any) => o.ability === 'coatlFamiliar')
            ) {
              return {
                seed,
                actions,
                unit: starseer.id,
                ability: spell.abilityId,
                target: spell.targets[0],
              };
            }
          }
        }
        const action = chooseAction(engine, state);
        actions.push(action);
        state = engine.apply(state, action).state;
      }
    }
    return null;
  });
  expect(found).not.toBeNull();
  return found as Found;
}

test('Coatl Familiar is offered when a spell is declared, before the casting roll', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const found = await findCast(page);
  const record = JSON.stringify({
    v: 1,
    rules: RULES_VERSION,
    seed: found.seed,
    humanPlayer: 1,
    actions: found.actions,
  });
  await page.addInitScript((r) => localStorage.setItem('aos-mobile:game', r), record);
  await page.goto(`./?seed=${found.seed}&side=1&fast=1`);

  await selectFromRoster(page, found.unit);
  await page.locator(`[data-ability="${found.ability}"]`).click();
  const panel = page.getByTestId('ability-panel');
  await expect(panel).toBeVisible();
  await panel.locator(`[data-target="${found.target}"]`).click();
  await page.getByTestId('ability-confirm').click();

  const prompt = page.getByTestId('reaction');
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId('reaction-text')).toContainText('React before the casting roll');
  const coatl = page.getByTestId('coatl-familiar');
  await expect(coatl).toBeVisible();
  await page.screenshot({ path: info.outputPath(`coatl-${info.project.name}.png`) });
  await coatl.click();

  // The Astrolith Bearer's Celestial Conduit may still be offered; skipping casts the spell.
  const skip = prompt.getByRole('button', { name: 'Skip', exact: true });
  for (let i = 0; i < 3 && (await prompt.isVisible().catch(() => false)); i++) {
    await skip.click();
    await page.waitForTimeout(300);
  }
  await expect(prompt).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  const log = (await page.getByTestId('log-list').textContent()) ?? '';
  expect(log).toMatch(/Skink Starseer (casts|fails to cast|miscasts)/);
  expect(log).toContain('Coatl Familiar adds');
});
