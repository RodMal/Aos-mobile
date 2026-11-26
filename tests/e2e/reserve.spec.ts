/**
 * M4j through the touch UI: Hidden Hunters sets a Hunters of Huanchi unit up in reserve in
 * ambush while deploying, and Chameleon Ambush sets it up in the owner's movement phase.
 *
 * The second part starts from a known position (tests/e2e/positions.ts: the NPC plays both
 * sides of a deployment game in the page and the app opens it as a saved game) instead of
 * playing NPC turns through the UI, whose timing varies on slow CI machines.
 */
import { expect, test } from '@playwright/test';
import type { Engine, GameState, UnitState } from '../../src/engine/index.js';
import { endPhaseUntil, selectFromRoster, startDeploy, usable } from './helpers.js';
import { openPosition } from './positions.js';

/** `src/ui/testHooks.ts`, loaded when the URL has `e2e`. */
interface Hooks {
  __aosTest: {
    engine: Engine;
    unitDistance: (scenario: Engine['scenario'], a: UnitState, b: UnitState) => number;
    isFactionTerrainUnit: (scenario: Engine['scenario'], u: UnitState) => boolean;
  };
}

test('Hidden Hunters while deploying', async ({ page }, info) => {
  test.setTimeout(120_000);
  await startDeploy(page, 'seed=5&side=1&new=1&deploy=1&fast=1');
  const confirm = page.getByTestId('place-confirm');
  const hidden = page.getByTestId('hidden-hunters');
  // Deploy until the first Hunters unit is the one to place.
  for (let i = 0; i < 60 && !(await hidden.isVisible()); i++) {
    if (await usable(confirm)) {
      await confirm.click();
    } else if (await confirm.isVisible()) {
      await page.getByRole('button', { name: 'Auto' }).click();
    }
    await page.waitForTimeout(300);
  }
  await expect(hidden).toBeVisible();
  await page.screenshot({ path: info.outputPath(`hidden-hunters-${info.project.name}.png`) });
  await hidden.click();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText(
    /is set up in reserve in ambush \(Hidden Hunters\)/,
  );
});

test('Chameleon Ambush in round 2: legal set-up, no move, may charge', async ({ page }, info) => {
  test.setTimeout(180_000);
  // The human (side 1, Seraphon) in their own movement phase of round 2, with a unit the NPC
  // hid with Hidden Hunters still waiting in ambush.
  const position = await openPosition(
    page,
    5,
    (_engine, s, d) => {
      if (d.kind !== 'main' || d.player !== 1 || d.phase !== 'movement' || s.round !== 2) {
        return null;
      }
      const hidden = Object.values(s.units).find(
        (u) => u.owner === 1 && u.status === 'reserve' && u.inAmbush === true,
      );
      return hidden ? hidden.id : null;
    },
    { side: 1, deploy: true },
  );
  const hunters = position.note;
  const phase = page.getByTestId('phase').locator('[aria-current="step"]');
  await expect(page.getByTestId('round')).toContainText('Round 2');
  await expect(phase).toHaveText(/Movement/);

  // The unit waits in ambush: the roster says so and the unit card offers Chameleon Ambush.
  await selectFromRoster(page, hunters);
  await expect(page.getByTestId('unit-panel')).toContainText('ambush');
  await page.screenshot({ path: info.outputPath(`ambush-card-${info.project.name}.png`) });
  await page.locator('[data-ability="4a89-1c50-df0e-4b2b"]').click();
  await page.getByTestId('ability-confirm').click();
  await expect(page.getByTestId('place-panel')).toBeVisible();
  const confirm = page.getByTestId('place-confirm');
  if (await page.getByRole('button', { name: 'Auto' }).isVisible()) {
    await page.getByRole('button', { name: 'Auto' }).click();
  }
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: info.outputPath(`chameleon-${info.project.name}.png`) });
  await confirm.click();
  await expect(page.getByTestId('place-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByTestId('log-list')).toContainText(/is set up again/);
  await page.getByTestId('log').getByRole('button', { name: 'Close' }).click();

  // Set up this turn: the unit card offers no move.
  await selectFromRoster(page, hunters);
  const card = page.getByTestId('unit-panel');
  await expect(card).not.toContainText('ambush');
  await expect(card.locator('[data-action="normal"], [data-action="run"]')).toHaveCount(0);

  // Reopen the saved game with the test hooks: the unit is on the battlefield, more than 9"
  // from every enemy unit.
  await page.goto(`./?e2e=1&seed=${position.seed}&side=1&fast=1`);
  await page.waitForFunction(() => !!(window as unknown as Partial<Hooks>).__aosTest);
  const placed = await page.evaluate((id) => {
    const { engine, unitDistance, isFactionTerrainUnit } = (window as unknown as Hooks).__aosTest;
    const record = JSON.parse(localStorage.getItem('aos-mobile:game')!) as {
      seed: number;
      actions: Parameters<Engine['apply']>[1][];
    };
    let state: GameState = engine.newGame(record.seed, { deploy: true });
    for (const a of record.actions) state = engine.apply(state, a).state;
    const unit = state.units[id]!;
    const enemies = Object.values(state.units).filter(
      (u) =>
        u.owner !== unit.owner &&
        u.status === 'battlefield' &&
        !isFactionTerrainUnit(engine.scenario, u),
    );
    return {
      status: unit.status,
      nearest: Math.min(...enemies.map((e) => unitDistance(engine.scenario, unit, e))),
    };
  }, hunters);
  expect(placed.status).toBe('battlefield');
  expect(placed.nearest).toBeGreaterThan(9);

  // It may still charge in the charge phase.
  await expect(phase).toHaveText(/Movement/);
  await endPhaseUntil(page, /Charge/);
  await selectFromRoster(page, hunters);
  await expect(page.getByTestId('unit-panel').locator('[data-action="charge"]')).toBeVisible();
});
