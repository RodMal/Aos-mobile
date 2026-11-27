/**
 * Manifestation abilities (M4l): Mechanisms of Time (two choices on the unit, and the charge
 * re-roll it gives) and Bound for the Great Oubliette (picking targets, and the reaction in the
 * opponent's hero phase). The positions are too deep to reach by playing, so each is set up by
 * hand through the e2e game hook.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from '@playwright/test';
import { selectFromRoster, startGame } from './helpers.js';

const E2E = 'e2e=1&seed=5&side=0&fast=1&new=1';
const COGS = 'm:0:1aba-bc38-e988-d79f';
const SHACKLES = 'm:0:dee3-92a0-27e7-252a';

/** Runs `edit` on a copy of the running game's state and puts the result back (in the page). */
async function editState(page: Page, edit: (state: any, engine: any) => void): Promise<void> {
  await page.evaluate(
    ({ source }) => {
      const { game, engine } = (window as any).__aosTest;
      const session = game.getState().session;
      const state = structuredClone(session.state);
      new Function('state', 'engine', `(${source})(state, engine)`)(state, engine);
      game.setState({ session: { ...session, state } });
    },
    { source: edit.toString() },
  );
}

test.describe('Chronomantic Cogs: Mechanisms of Time', () => {
  test('two choices on the unit; one is used and the other is gone for the turn', async ({
    page,
  }, info) => {
    await startGame(page, E2E);
    await editState(page, (state) => {
      const alarielle = state.units['0:0'];
      const at = alarielle.models[0];
      state.units['m:0:1aba-bc38-e988-d79f'] = {
        id: 'm:0:1aba-bc38-e988-d79f',
        owner: 0,
        profileId: '1aba-bc38-e988-d79f',
        name: 'Chronomantic Cogs',
        armyIndex: 99,
        models: [{ x: at.x + 4.5, y: at.y, rot: 0, alive: true }],
        damage: 0,
        status: 'battlefield',
        moved: null,
        charged: false,
        shot: false,
        fought: false,
        setUpThisTurn: false,
        isManifestation: true,
        summonedBy: '0:0',
      };
      state.unitOrder.push('m:0:1aba-bc38-e988-d79f');
    });
    await selectFromRoster(page, COGS);
    const actions = page.getByTestId('unit-actions');
    await expect(actions.locator(`[data-ability="ad92-932-6f56-1d97"]`)).toHaveCount(2);
    await expect(actions).toContainText('Increase Time Flow');
    await expect(actions).toContainText('Decrease Time Flow');
    await page.screenshot({ path: info.outputPath(`mechanisms-${info.project.name}.png`) });
    await actions.getByText('Decrease Time Flow').click();
    const panel = page.getByTestId('ability-panel');
    await expect(panel).toContainText('subtract 1 from hit rolls');
    await page.getByTestId('ability-confirm').click();
    await expect(panel).toHaveCount(0);
    // The effect shows on the unit, and the ability cannot be used again this turn.
    await selectFromRoster(page, COGS);
    await expect(page.getByTestId('unit-effects')).toContainText('Decrease Time Flow');
    await expect(page.locator(`[data-ability="ad92-932-6f56-1d97"]`)).toHaveCount(0);
  });

  test('Increase Time Flow: the charge roll can be re-rolled from the placing panel', async ({
    page,
  }, info) => {
    await startGame(page, E2E);
    await editState(page, (state) => {
      const alarielle = state.units['0:0'];
      const at = alarielle.models[0];
      const id = 'm:0:1aba-bc38-e988-d79f';
      state.units[id] = {
        id,
        owner: 0,
        profileId: '1aba-bc38-e988-d79f',
        name: 'Chronomantic Cogs',
        armyIndex: 99,
        models: [{ x: at.x, y: at.y + 3, rot: 0, alive: true }],
        damage: 0,
        status: 'battlefield',
        moved: null,
        charged: false,
        shot: false,
        fought: false,
        setUpThisTurn: false,
        isManifestation: true,
        summonedBy: '0:0',
      };
      state.unitOrder.push(id);
      // The Dryads have rolled a charge and are being placed; Increase Time Flow is in force.
      const dryads = state.units['0:6'];
      state.units[id].models[0].x = dryads.models[0].x;
      state.units[id].models[0].y = dryads.models[0].y + 3;
      dryads.chargeDeclared = true;
      state.effects = [
        ...(state.effects ?? []),
        {
          id: 'ad92-932-6f56-1d97',
          name: 'Increase Time Flow',
          sourceUnit: id,
          targetUnit: id,
          owner: 0,
          expires: 'startOfNextTurn',
          data: { mode: 'increase' },
        },
      ];
      state.active = 0;
      state.phase = 'charge';
      state.stack = [{ t: 'place', unit: '0:6', reason: 'charge', allowance: 7, dice: [3, 4] }];
    });
    const panel = page.getByTestId('place-panel');
    await expect(panel).toBeVisible();
    const reroll = panel.getByTestId('time-flow-reroll');
    await expect(reroll).toContainText('Increase Time Flow');
    await page.screenshot({ path: info.outputPath(`time-flow-reroll-${info.project.name}.png`) });
    await reroll.click();
    // The roll is made again and it is the only re-roll: the log shows both rolls.
    await page.getByRole('button', { name: 'Log' }).click();
    await expect(page.getByTestId('log-list')).toContainText('re-rolls its charge roll');
  });
});

test.describe('Soulsnare Shackles: Bound for the Great Oubliette', () => {
  /** Puts three Shackles parts in a row with an enemy unit by each of the first two. */
  const setShackles = (state: any): void => {
    const id = 'm:0:dee3-92a0-27e7-252a';
    const enemies = Object.values(state.units).filter(
      (u: any) =>
        u.owner === 1 &&
        u.status === 'battlefield' &&
        !u.isManifestation &&
        !u.id.endsWith(':terrain'),
    ) as any[];
    const [a, b] = enemies;
    a.models.forEach((m: any, i: number) => {
      m.x = 12 + (i % 3) * 1.4;
      m.y = 12 + Math.floor(i / 3) * 1.4;
    });
    b.models.forEach((m: any, i: number) => {
      m.x = 24 + (i % 3) * 1.4;
      m.y = 12 + Math.floor(i / 3) * 1.4;
    });
    state.units[id] = {
      id,
      owner: 0,
      profileId: 'dee3-92a0-27e7-252a',
      name: 'Soulsnare Shackles',
      armyIndex: 99,
      models: [
        { x: 13, y: 16, rot: 0, alive: true },
        { x: 19, y: 16, rot: 0, alive: true },
        { x: 25, y: 16, rot: 0, alive: true },
      ],
      damage: 0,
      status: 'battlefield',
      moved: null,
      charged: false,
      shot: false,
      fought: false,
      setUpThisTurn: false,
      isManifestation: true,
      summonedBy: '0:0',
    };
    state.unitOrder.push(id);
    // Everything else stays clear of the two enemy units.
    for (const u of enemies.slice(2)) {
      u.models.forEach((m: any, i: number) => {
        m.x = 40 + (i % 5) * 1.4;
        m.y = 36 + Math.floor(i / 5) * 1.4;
      });
    }
  };

  test('two units near only the same part cannot both be picked (one target for each part)', async ({
    page,
  }) => {
    await startGame(page, E2E);
    await editState(page, setShackles);
    await editState(page, (state: any) => {
      // Both enemy units by the first part only (the others are 6" away or more).
      const enemies = Object.values(state.units).filter(
        (u: any) => u.owner === 1 && u.status === 'battlefield' && u.armyIndex !== 99,
      ) as any[];
      const [a, b] = enemies.filter((u: any) => !u.isManifestation && !u.id.endsWith(':terrain'));
      a.models.forEach((m: any, i: number) => {
        m.x = 9 + (i % 2) * 1.4;
        m.y = 13 + Math.floor(i / 2) * 1.4;
      });
      b.models.forEach((m: any, i: number) => {
        m.x = 9 + (i % 2) * 1.4;
        m.y = 17.5 + Math.floor(i / 2) * 1.4;
      });
    });
    await selectFromRoster(page, SHACKLES);
    await page.locator('[data-ability="6817-e507-443e-1ff4"]').click();
    const chips = page
      .getByTestId('ability-panel')
      .getByTestId('ability-targets')
      .getByRole('radio');
    // Only one part reaches either unit: a single target to pick, not two.
    await expect(chips).toHaveCount(2);
    await expect(page.getByTestId('ability-panel').getByRole('checkbox')).toHaveCount(0);
    await chips.first().click();
    await page.getByTestId('ability-confirm').click();
    await expect(page.getByTestId('ability-panel')).toHaveCount(0);
  });

  test('in your hero phase the targets are picked on the ability panel, up to one for each part', async ({
    page,
  }, info) => {
    await startGame(page, E2E);
    await editState(page, setShackles);
    await selectFromRoster(page, SHACKLES);
    await page.locator('[data-ability="6817-e507-443e-1ff4"]').click();
    const panel = page.getByTestId('ability-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Bound for the Great Oubliette');
    await expect(page.getByTestId('ability-target-count')).toContainText('up to 2 targets');
    const chips = panel.getByTestId('ability-targets').getByRole('checkbox');
    await expect(chips).toHaveCount(2);
    await page.screenshot({ path: info.outputPath(`oubliette-panel-${info.project.name}.png`) });
    await chips.first().click();
    await chips.nth(1).click();
    await page.getByTestId('ability-confirm').click();
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'Log' }).click();
    await expect(page.getByTestId('log-list')).toContainText('Bound for the Great Oubliette');
  });

  test("in the opponent's hero phase it is offered as a reaction with the same target picks", async ({
    page,
  }, info) => {
    await startGame(page, E2E);
    await editState(page, setShackles);
    await editState(page, (state, engine) => {
      // The opponent's hero phase, ended: the reaction window opens for player 0.
      state.active = 1;
      state.phase = 'hero';
      state.stack = [];
      const r = engine.apply(state, { t: 'pass' });
      Object.assign(state, r.state);
    });
    const prompt = page.getByTestId('bound-oubliette');
    await expect(prompt).toBeVisible();
    await page.screenshot({ path: info.outputPath(`oubliette-reaction-${info.project.name}.png`) });
    const use = page.getByTestId('bound-oubliette-use');
    await expect(use).toBeDisabled();
    // One target for each part that can reach one: both units are picked.
    await prompt.locator('button.chip').first().click();
    await prompt.locator('button.chip').nth(1).click();
    await expect(use).toBeEnabled();
    await use.click();
    // Both units are picked for this turn (the window stays open for the other reactions).
    await expect(prompt).toHaveCount(0);
    const picked = await page.evaluate(
      () =>
        (window as any).__aosTest.game.getState().session.state.units['m:0:dee3-92a0-27e7-252a']
          .oublietteTargets,
    );
    expect(picked).toHaveLength(2);
  });
});
