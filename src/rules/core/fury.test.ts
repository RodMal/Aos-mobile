import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario, unitsOf } from '../../engine/index.js';
import { cloneState } from '../../engine/engine.js';
import { RngCursor } from '../../engine/rng.js';
import type { Ctx } from '../../engine/ctx.js';
import {
  applySimmeringRage,
  canUseEruptionOfFury,
  eruptionOfFuryTargets,
  initFury,
  resolveEruptionOfFury,
  spendRageToNegateDamage,
  ATTACKER_STARTING_FURY,
  DEFENDER_STARTING_FURY,
} from './fury.js';
import { profileOf } from '../../engine/query.js';
import { startGame } from '../../engine/test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

describe('Fury season rules (GHB 2026-27)', () => {
  it('initialises Fury levels (Raising the Heat) and Simmering Rage gives rage dice equal to fury', () => {
    const state = cloneState(startGame(engine, 1));
    initFury(state, 0);

    expect(state.players[0].furyLevel).toBe(ATTACKER_STARTING_FURY); // 1
    expect(state.players[1].furyLevel).toBe(DEFENDER_STARTING_FURY); // 2
    expect(state.players[0].rageDice).toBe(0);
    expect(state.players[1].rageDice).toBe(0);

    // Apply Simmering Rage at start of round
    applySimmeringRage(state);
    expect(state.players[0].rageDice).toBe(1);
    expect(state.players[1].rageDice).toBe(2);

    // Spending or discarding unspent rage dice then re-applying Simmering Rage
    state.players[0].rageDice = 0; // spent
    state.players[1].rageDice = 5; // accumulated / left over
    applySimmeringRage(state);
    expect(state.players[0].rageDice).toBe(1);
    expect(state.players[1].rageDice).toBe(2); // unspent discarded, set to fury level
  });

  it('Fight Through the Pain spends rage dice, lowers Fury level by 1 each, and negates damage on 3+', () => {
    const state = cloneState(startGame(engine, 1));
    initFury(state, 0);
    state.players[0].furyLevel = 4;
    state.players[0].rageDice = 3;

    // Use a deterministic cursor or test outcomes
    const ctx: Ctx = {
      scenario,
      s: state,
      events: [],
      rng: new RngCursor(10), // seed 10
    };

    const result = spendRageToNegateDamage(ctx, 0, 5, 2); // spend up to 2 dice
    expect(result.diceSpent).toBe(2);
    expect(state.players[0].rageDice).toBe(1); // 3 - 2
    expect(state.players[0].furyLevel).toBe(2); // 4 - 2
    expect(result.damageNegated).toBe(result.rolls.filter((r) => r >= 3).length);
    expect(ctx.events.some((e) => e.t === 'roll' && e.label === 'Fight Through the Pain')).toBe(
      true,
    );
  });

  it('Eruption of Fury makes combat attacks from rage dice, inflicts mortal damage on 6s, hurts user on 1s, and raises opponent fury', () => {
    const state = cloneState(startGame(engine, 1));
    initFury(state, 0);
    state.players[0].furyLevel = 3;
    state.players[0].rageDice = 3;
    state.players[1].furyLevel = 2;

    const durthu = unitsOf(state, 0).find((u) => u.name === 'Spirit of Durthu')!;
    const warriors = unitsOf(state, 1).find((u) => u.name === 'Saurus Warriors')!;

    // Place them in combat
    durthu.models[0]!.x = 20;
    durthu.models[0]!.y = 20;
    warriors.models[0]!.x = 21;
    warriors.models[0]!.y = 20;

    expect(canUseEruptionOfFury(scenario, state, durthu)).toBe(true);
    expect(eruptionOfFuryTargets(scenario, state, durthu).map((u) => u.id)).toContain(warriors.id);

    const durthuWeapon = profileOf(scenario, durthu).weapons.find((w) => w.kind === 'melee')!;

    const ctx: Ctx = {
      scenario,
      s: state,
      events: [],
      rng: new RngCursor(42),
    };

    const res = resolveEruptionOfFury(ctx, durthu, warriors, durthuWeapon, 3);
    expect(res.rageDiceSpent).toBe(3);
    expect(state.players[0].rageDice).toBe(0);
    expect(state.players[0].furyUsedThisTurn).toContain('eruption-of-fury');
    expect(canUseEruptionOfFury(scenario, state, durthu)).toBe(false); // already used this turn
  });
});
