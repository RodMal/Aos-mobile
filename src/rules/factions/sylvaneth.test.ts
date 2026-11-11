import { describe, expect, it } from 'vitest';
import { createEngine, createScenario, profileOf, type GameState } from '../../engine/index.js';
import type { Ctx } from '../../engine/ctx.js';
import { editable, keepOnly, placeUnit, ScriptedDice } from '../../engine/test-helpers.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { creepingOvergrowthRange, resolveEndlessGrowth } from './sylvaneth.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

function named(s: GameState, name: string) {
  return Object.values(s.units).find((u) => u.name === name)!;
}

function ctxWith(s: GameState, dice: number[]): Ctx {
  return { scenario, s, events: [], rng: new ScriptedDice(dice) };
}

/** Every battlefield terrain feature overgrown for player 0: the whole battlefield qualifies. */
function wholeBattlefield(s: GameState): void {
  s.overgrownTerrain = scenario.battlefield.terrain.map((t) => t.id);
}

describe('The Creeping Overgrowth', () => {
  it('range grows with the number of friendly overgrown tokens', () => {
    expect(creepingOvergrowthRange(0)).toBe(6);
    expect(creepingOvergrowthRange(2)).toBe(6);
    expect(creepingOvergrowthRange(3)).toBe(9);
    expect(creepingOvergrowthRange(5)).toBe(9);
    expect(creepingOvergrowthRange(6)).toBe(12);
    expect(creepingOvergrowthRange(8)).toBe(12);
    expect(creepingOvergrowthRange(9)).toBe(Infinity);
  });
});

describe('Endless Growth', () => {
  it('Nature’s Titans heals 3 on a Sylvaneth Monster without rolling', () => {
    const s = editable(engine.newGame(1));
    wholeBattlefield(s);
    const durthu = named(s, 'Spirit of Durthu');
    durthu.damage = 5;
    const ctx = ctxWith(s, []);
    resolveEndlessGrowth(ctx, 0);
    expect(durthu.damage).toBe(2);
  });

  it('rolls a D3 for a non-Monster: returns slain models that fit in the roll, else heals', () => {
    const s = editable(engine.newGame(1));
    wholeBattlefield(s);
    const dryads = named(s, 'Dryads');
    expect(profileOf(scenario, dryads).health).toBe(1);
    dryads.models[8]!.alive = false;
    dryads.models[9]!.alive = false;
    resolveEndlessGrowth(ctxWith(s, [2]), 0);
    expect(dryads.models.filter((m) => !m.alive)).toHaveLength(0);

    const s2 = editable(engine.newGame(1));
    wholeBattlefield(s2);
    const belthanos = named(s2, 'Belthanos, First Thorn of Kurnoth');
    const isMonster = profileOf(scenario, belthanos).keywords.includes('MONSTER');
    belthanos.damage = 4;
    resolveEndlessGrowth(ctxWith(s2, isMonster ? [] : [2]), 0);
    expect(belthanos.damage).toBe(isMonster ? 1 : 2);
  });

  it('does nothing for an army without the trait, or for units outside the overgrowth', () => {
    const s = editable(engine.newGame(1));
    wholeBattlefield(s);
    const krox = named(s, 'Kroxigor');
    krox.damage = 1;
    const ctx = ctxWith(s, []);
    resolveEndlessGrowth(ctx, 1);
    expect(krox.damage).toBe(1);
    expect(ctx.events).toEqual([]);

    const s2 = editable(engine.newGame(1));
    s2.overgrownTerrain = [];
    const durthu = named(s2, 'Spirit of Durthu');
    keepOnly(s2, [durthu.id]);
    placeUnit(scenario, s2, durthu.id, 30, 22);
    durthu.damage = 5;
    resolveEndlessGrowth(ctxWith(s2, []), 0);
    expect(durthu.damage).toBe(5);
  });

  it('runs at the end of the opponent’s turn as well as its own', () => {
    let s = editable(engine.newGame(1));
    wholeBattlefield(s);
    const durthu = named(s, 'Spirit of Durthu');
    durthu.damage = 5;
    s.active = 1;
    s.firstPlayer = 1;
    s.phase = 'end';
    s = engine.apply(s, { t: 'pass' }).state;
    // Pass any end-of-phase reaction the other player is offered.
    while (engine.decision(s)?.kind === 'reaction') s = engine.apply(s, { t: 'pass' }).state;
    expect(s.units[durthu.id]!.damage).toBe(2);
  });
});
