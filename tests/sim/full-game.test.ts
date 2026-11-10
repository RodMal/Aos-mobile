/**
 * Full-game simulations. Each seed plays a whole game with the default action at every
 * decision and checks the invariants after every step. `SIM_SEEDS` sets how many seeds run.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../src/data/lists.js';
import {
  createEngine,
  createScenario,
  unitFootprints,
  type GameState,
  type Scenario,
} from '../../src/engine/index.js';
import {
  checkCoherencyFootprints,
  footprintInsidePolygon,
  footprintsOverlap,
} from '../../src/geom/index.js';

const SEEDS = Number(process.env.SIM_SEEDS ?? 5);
const MAX_STEPS = 20_000;

export function checkInvariants(scenario: Scenario, state: GameState): void {
  const { width, height } = scenario.battlefield;
  const board = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ] as const;
  const all = [];
  for (const id of state.unitOrder) {
    const unit = state.units[id]!;
    if (unit.status !== 'battlefield') continue;
    const fps = unitFootprints(scenario, unit);
    expect(fps.length, `${unit.name} has living models`).toBeGreaterThan(0);
    expect(checkCoherencyFootprints(fps).coherent, `${unit.name} coherency`).toBe(true);
    for (const fp of fps)
      expect(footprintInsidePolygon(fp, board), `${unit.name} on board`).toBe(true);
    all.push(...fps);
  }
  for (let a = 0; a < all.length; a++) {
    for (let b = a + 1; b < all.length; b++) {
      expect(footprintsOverlap(all[a]!, all[b]!), 'bases overlap').toBe(false);
    }
  }
  for (const p of state.players) {
    expect(p.cp).toBeGreaterThanOrEqual(0);
    expect(p.vp).toBeGreaterThanOrEqual(0);
  }
  expect(JSON.parse(JSON.stringify(state))).toEqual(state);
}

describe('full games', () => {
  const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
  const engine = createEngine(scenario);

  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed} finishes five rounds with every invariant holding`, () => {
      let state = engine.newGame(seed);
      const actions = [];
      let steps = 0;
      checkInvariants(scenario, state);
      while (engine.decision(state)) {
        const action = engine.defaultAction(state);
        actions.push(action);
        state = engine.apply(state, action).state;
        checkInvariants(scenario, state);
        if (++steps > MAX_STEPS) throw new Error('game did not end');
      }
      expect(state.status).toBe('ended');
      expect(state.round).toBe(scenario.rounds);

      // The same seed and actions reproduce the same game.
      let replay = engine.newGame(seed);
      for (const a of actions) replay = engine.apply(replay, a).state;
      expect(replay).toEqual(state);
    });
  }
});
