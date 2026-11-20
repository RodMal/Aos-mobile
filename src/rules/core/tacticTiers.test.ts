/**
 * Strike and Domination tiers of Siege of Ashes and Legend of the Parch (task M4n). Each test
 * holds a passing position, then breaks one condition at a time: every break must fail the tier.
 * Player 0 (Sylvaneth) is on side B (west), player 1 (Seraphon) on side A (east); the objectives
 * are `golden-lions-1` (15, 22), `scions-of-the-comet` (30, 22) and `golden-lions-2` (45, 22).
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { cloneState } from '../../engine/engine.js';
import { createEngine, createScenario } from '../../engine/index.js';
import type { GameState } from '../../engine/index.js';
import { editable, keepOnly, placeUnit, startGame } from '../../engine/test-helpers.js';
import {
  evaluateBattleTactic,
  initBattleTactics,
  LEGEND_OF_THE_PARCH_ID,
  SIEGE_OF_ASHES_ID,
} from './battleTactics.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);
const objective = (id: string) => scenario.battlefield.objectives.find((o) => o.id === id)!;

function fresh(keep: string[]): GameState {
  const s = editable(cloneState(startGame(engine, 1)));
  initBattleTactics(scenario, s);
  keepOnly(s, keep);
  return s;
}
const control = (s: GameState, id: string, player: 0 | 1 | null) => {
  s.objectives.find((o) => o.id === id)!.controller = player;
};

describe('Siege of Ashes (player 1)', () => {
  const siege = (s: GameState, tier: 'strike' | 'domination') =>
    evaluateBattleTactic(scenario, s, 1, SIEGE_OF_ASHES_ID, tier);

  it('Strike, Outpost Territory: an objective in enemy territory held by a stationary unit and a charger', () => {
    const o = objective('golden-lions-1'); // in side B, the enemy's territory
    const setup = () => {
      const s = fresh(['1:1', '1:2']);
      placeUnit(scenario, s, '1:1', o.x, o.y);
      placeUnit(scenario, s, '1:2', o.x + 1, o.y);
      control(s, o.id, 1);
      s.units['1:1']!.moved = null;
      s.units['1:2']!.charged = true;
      return s;
    };
    expect(siege(setup(), 'strike')).toBe(true);

    const notHeld = setup();
    control(notHeld, o.id, 0);
    expect(siege(notHeld, 'strike')).toBe(false);

    const ownTerritory = setup();
    const own = objective('golden-lions-2'); // side A, friendly
    for (const id of ['1:1', '1:2']) placeUnit(scenario, ownTerritory, id, own.x, own.y);
    control(ownTerritory, o.id, null);
    control(ownTerritory, own.id, 1);
    expect(siege(ownTerritory, 'strike')).toBe(false);

    const noCharger = setup();
    noCharger.units['1:2']!.charged = false;
    expect(siege(noCharger, 'strike')).toBe(false);

    const noStationary = setup();
    noStationary.units['1:1']!.charged = true; // it charged: not stationary
    expect(siege(noStationary, 'strike')).toBe(false);

    const farAway = setup();
    placeUnit(scenario, farAway, '1:2', 50, 5);
    expect(siege(farAway, 'strike')).toBe(false);
  });

  it('Domination, Repel the Attackers: 3 units within 3" of the centre, none in combat', () => {
    const cx = scenario.battlefield.width / 2;
    const cy = scenario.battlefield.height / 2;
    const ids = ['1:1', '1:2', '1:5'];
    const setup = () => {
      const s = fresh([...ids, '0:6']);
      ids.forEach((id, i) => placeUnit(scenario, s, id, cx + i * 0.5, cy));
      placeUnit(scenario, s, '0:6', 5, 5);
      return s;
    };
    expect(siege(setup(), 'domination')).toBe(true);

    const two = setup();
    placeUnit(scenario, two, '1:5', cx + 12, cy);
    expect(siege(two, 'domination')).toBe(false);

    const inCombat = setup();
    placeUnit(scenario, inCombat, '0:6', cx + 1, cy + 4); // an enemy next to a unit in the middle
    expect(siege(inCombat, 'domination')).toBe(false);
  });
});

describe('Legend of the Parch (player 0)', () => {
  const parch = (s: GameState, tier: 'strike' | 'domination') =>
    evaluateBattleTactic(scenario, s, 0, LEGEND_OF_THE_PARCH_ID, tier);

  it('Strike, Command from the Front: 2+ Heroes all within 9" of an enemy, none slain this turn', () => {
    const setup = () => {
      const s = fresh(['0:0', '0:1', '1:2']);
      placeUnit(scenario, s, '1:2', 30, 22);
      placeUnit(scenario, s, '0:0', 25, 22);
      placeUnit(scenario, s, '0:1', 22, 22);
      return s;
    };
    expect(parch(setup(), 'strike')).toBe(true);

    const oneHero = fresh(['0:0', '1:2']);
    placeUnit(scenario, oneHero, '1:2', 30, 22);
    placeUnit(scenario, oneHero, '0:0', 25, 22);
    expect(parch(oneHero, 'strike')).toBe(false);

    const oneFar = setup();
    placeUnit(scenario, oneFar, '0:1', 5, 22);
    expect(parch(oneFar, 'strike')).toBe(false);

    const slain = setup();
    slain.unitsDestroyedThisTurn = [{ id: '0:2', owner: 0, isHero: true }];
    expect(parch(slain, 'strike')).toBe(false);

    // A non-Hero loss, or the enemy's Hero, does not matter.
    const other = setup();
    other.unitsDestroyedThisTurn = [
      { id: '0:6', owner: 0, isHero: false },
      { id: '1:0', owner: 1, isHero: true },
    ];
    expect(parch(other, 'strike')).toBe(true);
  });

  it('Domination, Hero of Legend: a new objective wholly outside your territory, a Hero contesting', () => {
    const o = objective('golden-lions-2'); // side A: outside player 0's territory
    const setup = () => {
      const s = fresh(['0:0', '0:6']);
      placeUnit(scenario, s, '0:0', o.x, o.y);
      placeUnit(scenario, s, '0:6', 5, 5);
      control(s, o.id, 0);
      s.turnStartObjectives = { [o.id]: null };
      return s;
    };
    expect(parch(setup(), 'domination')).toBe(true);

    const held = setup();
    held.turnStartObjectives = { [o.id]: 0 };
    expect(parch(held, 'domination')).toBe(false);

    const notControlled = setup();
    control(notControlled, o.id, null);
    expect(parch(notControlled, 'domination')).toBe(false);

    const notHero = setup();
    placeUnit(scenario, notHero, '0:0', 5, 5);
    placeUnit(scenario, notHero, '0:6', o.x, o.y);
    expect(parch(notHero, 'domination')).toBe(false);

    const own = objective('golden-lions-1'); // in player 0's own territory
    const inOwn = setup();
    placeUnit(scenario, inOwn, '0:0', own.x, own.y);
    control(inOwn, o.id, null);
    control(inOwn, own.id, 0);
    inOwn.turnStartObjectives = { [own.id]: null };
    expect(parch(inOwn, 'domination')).toBe(false);
  });
});
