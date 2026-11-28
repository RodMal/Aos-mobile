import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario } from '../engine/index.js';
import { startGame } from '../engine/test-helpers.js';
import { chooseAction } from './baseline.js';
import { chooseNpcAction, loadChampion } from './index.js';
import { NpcConfigSchema } from './params/schema.js';

const engine = createEngine(
  createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]),
);
const ok = { version: 0, weights: {}, priors: {}, features: {} };

describe('NpcConfig schema', () => {
  it('accepts a good config and rejects bad ones', () => {
    expect(NpcConfigSchema.safeParse(ok).success).toBe(true);
    expect(NpcConfigSchema.safeParse({ ...ok, version: -1 }).success).toBe(false);
    expect(NpcConfigSchema.safeParse({ ...ok, weights: { a: 'x' } }).success).toBe(false);
    expect(NpcConfigSchema.safeParse({ ...ok, features: undefined }).success).toBe(false);
    expect(NpcConfigSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it('loads the champion: version 0, every feature off', () => {
    const c = loadChampion();
    expect(c.version).toBe(0);
    expect(Object.values(c.features).some(Boolean)).toBe(false);
  });
});

describe('chooseNpcAction with the version-0 champion', () => {
  it.each([1, 2, 3])('gives the baseline action on every step of seed %i', (seed) => {
    let state = startGame(engine, seed);
    for (let i = 0; i < 150 && engine.decision(state); i++) {
      const action = chooseNpcAction(engine, state, loadChampion());
      expect(action).toEqual(chooseAction(engine, state));
      state = engine.apply(state, action).state;
    }
  });
});
