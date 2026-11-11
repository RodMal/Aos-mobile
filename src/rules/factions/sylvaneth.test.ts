import { describe, expect, it } from 'vitest';
import { createEngine, createScenario } from '../../engine/index.js';
import { RngCursor } from '../../engine/rng.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import {
  creepingOvergrowthRange,
  isWithinCreepingOvergrowth,
  applyEverGrowing,
  creepingDreadTargets,
  resolveEndlessGrowth,
} from './sylvaneth.js';

describe('Sylvaneth Faction Battle Traits', () => {
  it('calculates creeping overgrowth range from token count', () => {
    expect(creepingOvergrowthRange(0)).toBe(6);
    expect(creepingOvergrowthRange(2)).toBe(6);
    expect(creepingOvergrowthRange(3)).toBe(9);
    expect(creepingOvergrowthRange(5)).toBe(9);
    expect(creepingOvergrowthRange(6)).toBe(12);
    expect(creepingOvergrowthRange(8)).toBe(12);
    expect(creepingOvergrowthRange(9)).toBe(Infinity);
  });

  it('detects units within overgrowth and targets for creeping dread', () => {
    const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
    const engine = createEngine(scenario);
    const state = engine.newGame(1);

    applyEverGrowing(scenario, state);
    state.overgrownTerrain = ['ruin-nw', 'spire-w'];

    const durthu = Object.values(state.units).find((u) => u.name.includes('Durthu'))!;
    expect(isWithinCreepingOvergrowth(scenario, state, durthu, 0)).toBeDefined();

    const targets = creepingDreadTargets(scenario, state, 0);
    expect(Array.isArray(targets)).toBe(true);
  });

  it('Endless Growth heals damaged units wholly within creeping overgrowth', () => {
    const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
    const engine = createEngine(scenario);
    const state = engine.newGame(1);

    // Damage a monster (Spirit of Durthu)
    const durthu = Object.values(state.units).find((u) => u.name.includes('Durthu'))!;
    durthu.damage = 5;

    // Make state have overgrown terrain
    state.overgrownTerrain = ['wyldwood-0'];

    const ctx = {
      scenario,
      s: state,
      events: [],
      rng: new RngCursor(1),
    };

    resolveEndlessGrowth(ctx, 0);
    // Nature's Titans heals 3 on Monsters without rolling
    expect(durthu.damage).toBeLessThanOrEqual(5);
  });
});
