import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  type Action,
  type GameState,
} from './index.js';
import { applyUntil, editable, keepOnly, passTo, placeUnit } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);
const DURTHU = '0:2';
const DRYADS = '0:6';
const DRYADS_2 = '0:7';
const SKINKS = '1:7';

function arena(): GameState {
  const s = editable(engine.newGame(1));
  keepOnly(s, [DURTHU, DRYADS, DRYADS_2, SKINKS]);
  placeUnit(scenario, s, DURTHU, 20, 22);
  placeUnit(scenario, s, DRYADS, 10, 35);
  placeUnit(scenario, s, DRYADS_2, 10, 10);
  placeUnit(scenario, s, SKINKS, 34, 22, 270);
  return s;
}

describe('Rally', () => {
  function hurt(): GameState {
    const s = arena();
    const dryads = s.units[DRYADS]!;
    dryads.models[9]!.alive = false;
    dryads.models[8]!.alive = false;
    const durthu = s.units[DURTHU]!;
    durthu.damage = 5;
    return s;
  }

  it('is offered in your hero phase to a damaged unit not in combat', () => {
    const s = hurt();
    expect(engine.unitOptions(s, DRYADS)).toEqual([{ t: 'command', command: 'rally', cost: 1 }]);
    expect(engine.unitOptions(s, DRYADS_2)).toEqual([]); // nothing to heal
    const later = passTo(engine, s, 'movement');
    expect(
      engine.unitOptions(later, DRYADS).some((o) => o.t === 'command' && o.command === 'rally'),
    ).toBe(false);
  });

  it('rolls 6 dice; returns slain models for Health points each, then heals', () => {
    const s = hurt();
    const r = applyUntil(engine, s, { t: 'command', command: 'rally', unit: DRYADS }, (x) =>
      x.events.some((e) => e.t === 'roll' && e.dice.filter((d) => d >= 4).length === 2),
    );
    expect(r.state.units[DRYADS]!.models.every((m) => m.alive)).toBe(true);
    expect(r.state.players[0].cp).toBe(3);
    const roll = r.events.find((e) => e.t === 'roll');
    expect(roll).toMatchObject({ label: 'Rally' });
    expect(roll?.t === 'roll' && roll.dice).toHaveLength(6);
  });

  it('heals the damage pool of a unit with no slain models', () => {
    const s = hurt();
    const r = applyUntil(engine, s, { t: 'command', command: 'rally', unit: DURTHU }, (x) =>
      x.events.some((e) => e.t === 'roll' && e.dice.filter((d) => d >= 4).length === 3),
    );
    expect(r.state.units[DURTHU]!.damage).toBe(2);
  });

  it('each command once per army per phase, and one command per unit per phase', () => {
    const s = hurt();
    const after = engine.apply(s, { t: 'command', command: 'rally', unit: DRYADS }).state;
    expect(() => engine.apply(after, { t: 'command', command: 'rally', unit: DURTHU })).toThrow(
      IllegalActionError,
    );
  });

  it('a unit in combat cannot rally', () => {
    const s = hurt();
    placeUnit(scenario, s, SKINKS, 10, 31);
    expect(engine.unitOptions(s, DRYADS)).toEqual([]);
  });
});

describe('At the Double', () => {
  it('a run whose roll counts as 6, for 1 CP', () => {
    const s = passTo(engine, arena(), 'movement');
    const r = engine.apply(s, { t: 'command', command: 'atTheDouble', unit: DRYADS });
    expect(engine.decision(r.state)).toMatchObject({
      kind: 'place',
      reason: 'run',
      allowance: 12,
      dice: [6],
    });
    expect(r.state.players[0].cp).toBe(3);
    expect(r.state.units[DRYADS]!.moved).toBe('run');
    const flag = engine.apply(s, { t: 'move', unit: DRYADS, kind: 'run', atTheDouble: true });
    expect(flag.state).toEqual(r.state);
  });

  it('cannot be used twice in a phase or without CP', () => {
    const s = passTo(engine, arena(), 'movement');
    const once = engine.apply(s, { t: 'command', command: 'atTheDouble', unit: DRYADS });
    const back = engine.apply(once.state, { t: 'pass' }).state;
    expect(() =>
      engine.apply(back, { t: 'command', command: 'atTheDouble', unit: DRYADS_2 }),
    ).toThrow(IllegalActionError);
    const broke = editable(s);
    broke.players[0].cp = 0;
    expect(engine.unitOptions(broke, DRYADS).some((o) => o.t === 'command')).toBe(false);
  });
});

describe('All-out Attack', () => {
  it('costs 1 CP, adds 1 to hit for those attacks and -1 save for the rest of the turn', () => {
    const s = passTo(engine, arena(), 'shooting');
    s.players[1].cp = 0;
    const weaponId = engine.targetOptions(s, DURTHU, 'shoot')[0]!.weaponId;
    const r = engine.apply(s, {
      t: 'shoot',
      unit: DURTHU,
      allocations: [{ weaponId, target: SKINKS }],
      allOutAttack: true,
    });
    expect(r.events[0]).toEqual({ t: 'command', player: 0, command: 'allOutAttack', unit: DURTHU });
    expect(r.state.players[0].cp).toBe(3);
    expect(r.state.units[DURTHU]!.allOutAttack).toBe(true);
    // An enemy shooting Durthu now sees the save penalty in its expected damage.
    const plain = editable(s);
    const flagged = editable(r.state);
    for (const st of [plain, flagged]) {
      st.active = 1;
      st.units[SKINKS]!.shot = false;
    }
    const exp = (st: GameState): number =>
      engine.targetOptions(st, SKINKS, 'shoot')[0]!.targets.find((t) => t.unit === DURTHU)!
        .expectedDamage;
    expect(exp(flagged)).toBeGreaterThan(exp(plain));
  });

  it('cannot be used without CP', () => {
    const s = passTo(engine, arena(), 'shooting');
    s.players[0].cp = 0;
    const weaponId = engine.targetOptions(s, DURTHU, 'shoot')[0]!.weaponId;
    expect(() =>
      engine.apply(s, {
        t: 'shoot',
        unit: DURTHU,
        allocations: [{ weaponId, target: SKINKS }],
        allOutAttack: true,
      }),
    ).toThrow(/CP/);
  });
});

describe('All-out Defence', () => {
  it('is offered only when the defender has CP; passing resolves the attacks as normal', () => {
    const s = passTo(engine, arena(), 'shooting');
    const weaponId = engine.targetOptions(s, DURTHU, 'shoot')[0]!.weaponId;
    const shoot: Action = {
      t: 'shoot',
      unit: DURTHU,
      allocations: [{ weaponId, target: SKINKS }],
    };
    const r = engine.apply(s, shoot);
    expect(engine.decision(r.state)).toMatchObject({ kind: 'reaction', player: 1 });
    expect(r.events.some((e) => e.t === 'attacks')).toBe(false);
    const passed = engine.apply(r.state, { t: 'pass' });
    expect(passed.events.some((e) => e.t === 'attacks')).toBe(true);
    expect(passed.state.stack).toEqual([]);
    const broke = editable(s);
    broke.players[1].cp = 0;
    expect(engine.decision(engine.apply(broke, shoot).state)).toMatchObject({ kind: 'main' });
  });
});
