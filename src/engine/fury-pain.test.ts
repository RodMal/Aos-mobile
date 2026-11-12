import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { chooseAction } from '../ai/baseline.js';
import { createEngine, createScenario, IllegalActionError, type GameState } from './index.js';
import { applyUntil, editable, keepOnly, passTo, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);
const DURTHU = '0:2';
const SKINKS = '1:7';

/** Player 0's shooting phase, Durthu 14" from the Skinks; player 1 holds 3 rage dice. */
function arena(): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, [DURTHU, SKINKS]);
  placeUnit(scenario, s, DURTHU, 20, 22);
  placeUnit(scenario, s, SKINKS, 34, 22, 270);
  s.players[1].cp = 0; // no All-out Defence prompt
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 3;
  s.players[1].furyLevel = 3;
  return passTo(engine, s, 'shooting');
}

function shoot(s: GameState) {
  const weaponId = engine.targetOptions(s, DURTHU, 'shoot')[0]!.weaponId;
  return applyUntil(
    engine,
    s,
    { t: 'shoot', unit: DURTHU, allocations: [{ weaponId, target: SKINKS }] },
    (r) => r.events.some((e) => e.t === 'attacks' && e.damage >= 2),
  );
}

describe('Fight Through the Pain (wired into damage allocation)', () => {
  it('asks the target’s owner before attack damage is allocated, showing the damage', () => {
    const r = shoot(arena());
    const attacks = r.events.find((e) => e.t === 'attacks')!;
    if (attacks.t !== 'attacks') throw new Error('no attacks');
    expect(r.events.some((e) => e.t === 'damage')).toBe(false);
    expect(engine.decision(r.state)).toEqual({
      kind: 'reaction',
      player: 1,
      trigger: `pain:${SKINKS}:${attacks.damage}`,
      options: [
        {
          ability: 'fightThroughThePain',
          unit: SKINKS,
          cost: 0,
          damage: attacks.damage,
          maxRageDice: 3,
        },
      ],
    });
    // Passing takes all of it; the default action passes.
    expect(engine.defaultAction(r.state)).toEqual({ t: 'pass' });
    const passed = engine.apply(r.state, { t: 'pass' });
    expect(passed.events).toContainEqual(
      expect.objectContaining({ t: 'damage', unit: SKINKS, amount: attacks.damage }),
    );
    expect(passed.state.players[1].rageDice).toBe(3);
    expect(engine.decision(passed.state)).toMatchObject({ kind: 'main', phase: 'shooting' });
  });

  it('spending dice lowers fury, rolls a D6 each and removes 1 damage per 3+', () => {
    const r = shoot(arena());
    const attacks = r.events.find((e) => e.t === 'attacks')!;
    if (attacks.t !== 'attacks') throw new Error('no attacks');
    const spent = engine.apply(r.state, {
      t: 'ability',
      unit: SKINKS,
      abilityId: 'fight-through-the-pain',
      rageDice: 2,
    });
    const roll = spent.events.find((e) => e.t === 'roll' && e.label === 'Fight Through the Pain');
    if (roll?.t !== 'roll') throw new Error('no roll');
    const negated = roll.dice.filter((d) => d >= 3).length;
    expect(spent.state.players[1].rageDice).toBe(3 - roll.dice.length);
    expect(spent.state.players[1].furyLevel).toBe(3 - roll.dice.length);
    const allocated = spent.events
      .filter((e) => e.t === 'damage' && e.unit === SKINKS)
      .reduce((a, e) => a + (e.t === 'damage' ? e.amount : 0), 0);
    expect(allocated).toBe(attacks.damage - negated);
  });

  it('rejects 0 dice, more dice than held, and a different unit', () => {
    const r = shoot(arena());
    const base = { t: 'ability', unit: SKINKS, abilityId: 'fight-through-the-pain' } as const;
    expect(() => engine.apply(r.state, { ...base, rageDice: 0 })).toThrow(IllegalActionError);
    expect(() => engine.apply(r.state, { ...base, rageDice: 4 })).toThrow(IllegalActionError);
    expect(() => engine.apply(r.state, { t: 'command', command: 'rally', unit: SKINKS })).toThrow(
      IllegalActionError,
    );
  });

  it('is not asked when the target’s owner holds no rage dice', () => {
    const s = arena();
    s.players[1].rageDice = 0;
    const r = shoot(s);
    expect(r.events.some((e) => e.t === 'damage' && e.unit === SKINKS)).toBe(true);
    expect(engine.decision(r.state)).toMatchObject({ kind: 'main' });
  });

  it('the NPC spends dice only when a model would be slain', () => {
    const r = shoot(arena());
    const d = engine.decision(r.state)!;
    if (d.kind !== 'reaction') throw new Error('expected a reaction');
    // Skinks have Health 1: any damage slays a model, so the NPC spends.
    expect(chooseAction(engine, r.state)).toMatchObject({
      t: 'ability',
      abilityId: 'fight-through-the-pain',
      unit: SKINKS,
    });
    expect(() => engine.apply(r.state, chooseAction(engine, r.state))).not.toThrow();
  });
});
