/**
 * Seraphon activated abilities (task M4h): Venomite Swarm, Celestial Conduit, Scry the Stars,
 * Coatl Familiar, Ark of Sotek, Armour Cruncher and Star-venom. One block per ability; printed
 * text in data/factions/seraphon.json, readings in docs/RULES-DECISIONS.md I104 and I105.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { controlScores } from '../rules/core/objectives.js';
import { attackModifiers } from '../rules/core/modifiers.js';
import { conduitControlBonus } from '../rules/factions/conduit.js';
import { clearExpiredEffects, effectiveWard } from './abilities/effects.js';
import {
  ARK_OF_SOTEK_ID,
  ARMOUR_CRUNCHER_ID,
  CELESTIAL_CONDUIT_ID,
  COATL_FAMILIAR_ID,
  DARTPIPE_DAMAGE_ID,
  SCRY_THE_STARS_ID,
  STAR_VENOM_ID,
  VENOMITE_SWARM_ID,
} from './abilities/seraphon.js';
import { RngCursor } from './rng.js';
import { endTurn } from './turns.js';
import { ARMOUR_CRUNCHER_ROLL_ID } from './seraphonActive.js';
import { createEngine, createScenario, type GameState } from './index.js';
import { profileOf } from './query.js';
import type { Action, GameEvent, StepResult, UnitId } from './types.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN]);
const engine = createEngine(scenario);

const KROAK = '0:0';
const SUNBLOOD = '0:2';
const ASTROLITH = '0:4';
const WARRIORS = '0:5';
const STARSEER = '0:6';
const BASTILADON = '0:7';
const HUNTERS = '0:8';
const BELTHANOS = '1:1';
const DRYADS = '1:6';
const DRYADS2 = '1:7';
const SPITES = '1:4';
const DRYCHA = '1:3';

type Phase = GameState['phase'];

function arena(at: Record<string, [number, number, number?]>, phase: Phase): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y, facing]] of Object.entries(at)) placeUnit(scenario, s, id, x, y, facing);
  s.active = 0;
  s.phase = phase;
  s.stack = [];
  s.players[0].cp = 0;
  s.players[1].cp = 0;
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return s;
}

const option = (s: GameState, id: UnitId, abilityId: string) =>
  engine.unitOptions(s, id).find((o) => o.t === 'ability' && o.abilityId === abilityId);
const rolls = (events: GameEvent[], label: string): number[] =>
  events.flatMap((e) => (e.t === 'roll' && e.label === label ? e.dice : []));
const use = (unit: UnitId, abilityId: string, extra: Partial<Action> = {}): Action =>
  ({ t: 'ability', unit, abilityId, ...extra }) as Action;
const effectsOf = (s: GameState, id: string, target?: UnitId) =>
  (s.effects ?? []).filter((e) => e.id === id && (!target || e.targetUnit === target));

/** Two units standing in combat, the first facing the second. */
const duel = (a: string, b: string, extra: Record<string, [number, number, number?]> = {}) =>
  arena({ [a]: [30, 30, 90], [b]: [34, 30, 270], ...extra }, 'combat');

describe('Venomite Swarm (cf2e-d237-9320-1105)', () => {
  const fight = () => duel(SUNBLOOD, BELTHANOS);

  it('is offered while a fighter is picked, against an enemy in combat with the unit', () => {
    const s = fight();
    expect(engine.decision(s)).toMatchObject({ kind: 'fightPick', player: 0 });
    expect(option(s, SUNBLOOD, VENOMITE_SWARM_ID)).toMatchObject({ targets: [BELTHANOS] });
    const apart = editable(s);
    placeUnit(scenario, apart, BELTHANOS, 50, 30);
    expect(option(apart, SUNBLOOD, VENOMITE_SWARM_ID)).toBeUndefined();
  });

  it('inflicts mortal damage equal to a D3 roll of 2 or more, once per turn for the army', () => {
    const s = fight();
    const r = applyUntil(
      engine,
      s,
      use(SUNBLOOD, VENOMITE_SWARM_ID, { target: BELTHANOS }),
      (x) => rolls(x.events, 'Venomite Swarm')[0]! >= 2,
    );
    const die = rolls(r.events, 'Venomite Swarm')[0]!;
    expect(r.state.units[BELTHANOS]!.damage).toBe(die);
    expect(r.state.units[SUNBLOOD]!.venomitesGone).toBeUndefined();
    expect(option(r.state, SUNBLOOD, VENOMITE_SWARM_ID)).toBeUndefined();
  });

  it('removes the Venomites token on a 1, and then cannot be used again', () => {
    const s = fight();
    const r = applyUntil(
      engine,
      s,
      use(SUNBLOOD, VENOMITE_SWARM_ID, { target: BELTHANOS }),
      (x) => rolls(x.events, 'Venomite Swarm')[0] === 1,
    );
    expect(r.state.units[BELTHANOS]!.damage).toBe(0);
    expect(r.state.units[SUNBLOOD]!.venomitesGone).toBe(true);
    // Next turn the use is back, but with no token there is nothing to roll.
    const next = editable(r.state);
    next.players[0].usedOncePerTurn = [];
    next.units[SUNBLOOD]!.abilitiesUsed = [];
    expect(option(next, SUNBLOOD, VENOMITE_SWARM_ID)).toBeUndefined();
  });

  it('is not available in the other phases', () => {
    const s = fight();
    s.phase = 'shooting';
    expect(option(s, SUNBLOOD, VENOMITE_SWARM_ID)).toBeUndefined();
  });
});

describe('Ark of Sotek (714c-4cb6-fce8-6ef9)', () => {
  const field = () =>
    arena(
      {
        [BASTILADON]: [30, 30, 90],
        [BELTHANOS]: [34, 30, 270],
        [SPITES]: [30, 38],
        [DRYCHA]: [20, 30],
        [DRYADS2]: [30, 50],
      },
      'combat',
    );

  it('picks up to 3 different enemy units within 9", not the one further away', () => {
    const s = field();
    const opt = option(s, BASTILADON, ARK_OF_SOTEK_ID);
    expect(opt).toMatchObject({ maxTargets: 3 });
    expect(opt?.t === 'ability' ? [...opt.targets].sort() : []).toEqual(
      [BELTHANOS, SPITES, DRYCHA].sort(),
    );
  });

  it('rolls a D3 for each target and inflicts mortal damage on a 2+', () => {
    const s = field();
    const r = applyUntil(
      engine,
      s,
      use(BASTILADON, ARK_OF_SOTEK_ID, { targets: [BELTHANOS, SPITES] }),
      (x) => {
        const d = rolls(x.events, 'Ark of Sotek');
        return d.length === 2 && d[0]! >= 2 && d[1] === 1;
      },
    );
    const [first] = rolls(r.events, 'Ark of Sotek');
    expect(rolls(r.events, 'Ark of Sotek')).toHaveLength(2);
    expect(r.state.units[BELTHANOS]!.damage).toBe(first);
    expect(r.state.units[SPITES]!.damage).toBe(0);
    expect(r.state.units[DRYCHA]!.damage).toBe(0);
    // Once per turn for the army.
    expect(option(r.state, BASTILADON, ARK_OF_SOTEK_ID)).toBeUndefined();
  });

  it('refuses a 4th target, a repeated one and one out of range', () => {
    const s = field();
    const more = [BELTHANOS, SPITES, DRYCHA, DRYADS2];
    expect(() => engine.apply(s, use(BASTILADON, ARK_OF_SOTEK_ID, { targets: more }))).toThrow();
    expect(() =>
      engine.apply(s, use(BASTILADON, ARK_OF_SOTEK_ID, { targets: [BELTHANOS, BELTHANOS] })),
    ).toThrow();
    expect(() =>
      engine.apply(s, use(BASTILADON, ARK_OF_SOTEK_ID, { targets: [DRYADS2] })),
    ).toThrow();
  });
});

describe('Armour Cruncher (f6fe-3e8d-dd90-00b8)', () => {
  const field = () => {
    const s = duel(BASTILADON, DRYADS);
    s.players[0].rageDice = 3;
    s.players[0].furyLevel = 3;
    s.players[1].furyLevel = 1;
    return s;
  };
  const cruncher = () => use(BASTILADON, ARMOUR_CRUNCHER_ID, { target: DRYADS });
  const rolled = () => use(BASTILADON, ARMOUR_CRUNCHER_ROLL_ID, { target: DRYADS });

  it('offers spending a rage dice (with one) or rolling a dice (always) against a unit in combat', () => {
    const s = field();
    expect(option(s, BASTILADON, ARMOUR_CRUNCHER_ID)).toMatchObject({ targets: [DRYADS] });
    expect(option(s, BASTILADON, ARMOUR_CRUNCHER_ROLL_ID)).toMatchObject({ targets: [DRYADS] });
    s.players[0].rageDice = 0;
    expect(option(s, BASTILADON, ARMOUR_CRUNCHER_ID)).toBeUndefined();
    expect(option(s, BASTILADON, ARMOUR_CRUNCHER_ROLL_ID)).toBeDefined();
  });

  it('spending a rage dice always applies the effect, and raises a lower fury level by 1', () => {
    const s = field();
    const r = engine.apply(s, cruncher());
    expect(r.state.players[0].rageDice).toBe(2);
    expect(r.state.players[1].furyLevel).toBe(2);
    expect(rolls(r.events, 'Armour Cruncher')).toEqual([]);
    expect(effectsOf(r.state, ARMOUR_CRUNCHER_ID, DRYADS)).toHaveLength(1);
    // Not lower: the effect still applies, the fury level stays.
    const even = field();
    even.players[1].furyLevel = 3;
    const e = engine.apply(even, cruncher());
    expect(e.state.players[1].furyLevel).toBe(3);
    expect(e.state.players[0].rageDice).toBe(2);
    expect(effectsOf(e.state, ARMOUR_CRUNCHER_ID, DRYADS)).toHaveLength(1);
  });

  it('does not raise the fury level above 7', () => {
    const s = field();
    s.players[0].furyLevel = 7;
    s.players[1].furyLevel = 6;
    expect(engine.apply(s, cruncher()).state.players[1].furyLevel).toBe(7);
    s.players[1].furyLevel = 7;
    expect(engine.apply(s, cruncher()).state.players[1].furyLevel).toBe(7);
  });

  it('not spending rolls a dice: the Save or more applies the effect, less does not', () => {
    const save = profileOf(scenario, field().units[DRYADS]!).save;
    const hit = applyUntil(
      engine,
      field(),
      rolled(),
      (x) => rolls(x.events, 'Armour Cruncher')[0]! >= save,
    );
    expect(hit.state.players[0].rageDice).toBe(3);
    expect(hit.state.players[1].furyLevel).toBe(1);
    expect(effectsOf(hit.state, ARMOUR_CRUNCHER_ID, DRYADS)).toHaveLength(1);
    const miss = applyUntil(
      engine,
      field(),
      rolled(),
      (x) => rolls(x.events, 'Armour Cruncher')[0]! < save,
    );
    expect(miss.state.players[0].rageDice).toBe(3);
    expect(effectsOf(miss.state, ARMOUR_CRUNCHER_ID)).toHaveLength(0);
    // With no rage dice at all, rolling is still possible.
    const none = field();
    none.players[0].rageDice = 0;
    expect(() => engine.apply(none, rolled())).not.toThrow();
    expect(() => engine.apply(none, cruncher())).toThrow();
  });

  it('subtracts 1 from the target’s save rolls and lasts the turn', () => {
    const s = field();
    const r = engine.apply(s, cruncher());
    const weapon = profileOf(scenario, r.state.units[BASTILADON]!).weapons[0]!;
    const saves = (state: GameState) =>
      attackModifiers(scenario, state, {
        attacker: state.units[BASTILADON]!,
        target: state.units[DRYADS]!,
        weapon,
        mode: 'fight',
      }).filter((m) => m.stat === 'save' && m.source === 'Armour Cruncher');
    expect(saves(r.state)).toEqual([{ stat: 'save', value: -1, source: 'Armour Cruncher' }]);
    expect(saves(s)).toEqual([]);
    // Once on a unit per turn: the unit does not use it again.
    expect(option(r.state, BASTILADON, ARMOUR_CRUNCHER_ID)).toBeUndefined();
    const over = editable(r.state);
    clearExpiredEffects(over, 'turn');
    expect(saves(over)).toEqual([]);
  });
});

describe('Star-venom (c71d-2217-fcf1-6110)', () => {
  const field = () => {
    const s = arena({ [HUNTERS]: [30, 20], [BELTHANOS]: [30, 28] }, 'shooting');
    return s;
  };
  const shoot = (s: GameState): Action => {
    const weapon = profileOf(scenario, s.units[HUNTERS]!).weapons.find((w) => w.kind === 'ranged')!;
    return { t: 'shoot', unit: HUNTERS, allocations: [{ weaponId: weapon.id, target: BELTHANOS }] };
  };

  it('is offered only against a unit the Dartpipe damaged this turn', () => {
    const s = field();
    expect(option(s, HUNTERS, STAR_VENOM_ID)).toBeUndefined();
    const shot = applyUntil(
      engine,
      s,
      shoot(s),
      (x) => x.state.units[BELTHANOS]!.damage > 0 && engine.decision(x.state)?.kind === 'main',
    );
    expect(effectsOf(shot.state, DARTPIPE_DAMAGE_ID, BELTHANOS)).toHaveLength(1);
    expect(option(shot.state, HUNTERS, STAR_VENOM_ID)).toMatchObject({ targets: [BELTHANOS] });
    const unhurt = applyUntil(
      engine,
      s,
      shoot(s),
      (x) => x.state.units[BELTHANOS]!.damage === 0 && engine.decision(x.state)?.kind === 'main',
    );
    expect(option(unhurt.state, HUNTERS, STAR_VENOM_ID)).toBeUndefined();
  });

  const damaged = (): GameState =>
    applyUntil(
      engine,
      field(),
      shoot(field()),
      (x) => x.state.units[BELTHANOS]!.damage > 0 && engine.decision(x.state)?.kind === 'main',
    ).state;

  it('on a 2+ subtracts 1 from wound rolls for the target’s combat attacks this turn', () => {
    const s = damaged();
    const r = applyUntil(
      engine,
      s,
      use(HUNTERS, STAR_VENOM_ID, { target: BELTHANOS }),
      (x) => rolls(x.events, 'Star-venom')[0]! >= 2,
    );
    expect(effectsOf(r.state, STAR_VENOM_ID, BELTHANOS)).toHaveLength(1);
    const claw = profileOf(scenario, r.state.units[BELTHANOS]!).weapons.find(
      (w) => w.kind === 'melee',
    )!;
    const wound = (state: GameState, mode: 'fight' | 'shoot') =>
      attackModifiers(scenario, state, {
        attacker: state.units[BELTHANOS]!,
        target: state.units[HUNTERS]!,
        weapon: claw,
        mode,
      }).filter((m) => m.stat === 'wound' && m.source === 'Star-venom');
    expect(wound(r.state, 'fight')).toEqual([{ stat: 'wound', value: -1, source: 'Star-venom' }]);
    // Combat attacks only.
    expect(wound(r.state, 'shoot')).toEqual([]);
    expect(wound(s, 'fight')).toEqual([]);
    // Once a turn for the unit.
    expect(option(r.state, HUNTERS, STAR_VENOM_ID)).toBeUndefined();
  });

  it('does nothing on a 1', () => {
    const r = applyUntil(
      engine,
      damaged(),
      use(HUNTERS, STAR_VENOM_ID, { target: BELTHANOS }),
      (x) => rolls(x.events, 'Star-venom')[0] === 1,
    );
    expect(effectsOf(r.state, STAR_VENOM_ID)).toHaveLength(0);
  });
});

describe('Scry the Stars (b8a5-8e24-ad08-d213)', () => {
  const field = (round: number) => {
    const s = arena(
      {
        [STARSEER]: [30, 20],
        [WARRIORS]: [30, 28],
        [ASTROLITH]: [38, 20],
        [HUNTERS]: [30, 60],
        [DRYADS]: [50, 20],
      },
      'hero',
    );
    s.round = round;
    return s;
  };
  const scry = (targets: UnitId[]) => use(STARSEER, SCRY_THE_STARS_ID, { targets });

  it('offers Seraphon units wholly within 18", and as many picks as the battle round', () => {
    const s = field(2);
    const opt = option(s, STARSEER, SCRY_THE_STARS_ID);
    expect(opt).toMatchObject({ maxTargets: 2 });
    expect(opt?.t === 'ability' ? [...opt.targets].sort() : []).toEqual(
      [STARSEER, WARRIORS, ASTROLITH].sort(),
    );
    expect(option(field(1), STARSEER, SCRY_THE_STARS_ID)).toMatchObject({ maxTargets: 1 });
  });

  it('rolls a dice per round and gives Ward (5+) for each 3+ to the units picked', () => {
    const s = field(3);
    const r: StepResult = applyUntil(engine, s, scry([WARRIORS, ASTROLITH, STARSEER]), (x) => {
      const d = rolls(x.events, 'Scry the Stars');
      return d.length === 3 && d.filter((v) => v >= 3).length === 2;
    });
    expect(rolls(r.events, 'Scry the Stars')).toHaveLength(3);
    expect(effectiveWard(scenario, r.state, r.state.units[WARRIORS]!)).toBe(5);
    expect(effectiveWard(scenario, r.state, r.state.units[ASTROLITH]!)).toBe(5);
    // The Starseer keeps the Ward (6+) the Astrolith Bearer gives it.
    expect(effectiveWard(scenario, r.state, r.state.units[STARSEER]!)).toBe(6);
    // Until the start of the player's next turn.
    const next = editable(r.state);
    clearExpiredEffects(next, 'startOfNextTurn', 1);
    expect(effectiveWard(scenario, next, next.units[WARRIORS]!)).toBe(5);
    clearExpiredEffects(next, 'startOfNextTurn', 0);
    expect(effectiveWard(scenario, next, next.units[WARRIORS]!)).toBeUndefined();
    // Once per battle for the army.
    expect(option(r.state, STARSEER, SCRY_THE_STARS_ID)).toBeUndefined();
  });

  it('gives nothing when no dice is a 3+', () => {
    const r = applyUntil(engine, field(1), scry([WARRIORS]), (x) =>
      rolls(x.events, 'Scry the Stars').every((v) => v < 3),
    );
    expect(effectsOf(r.state, SCRY_THE_STARS_ID)).toHaveLength(0);
    expect(option(r.state, STARSEER, SCRY_THE_STARS_ID)).toBeUndefined();
  });

  it('refuses a unit beyond 18", an enemy unit and more picks than the round', () => {
    const s = field(1);
    expect(() => engine.apply(s, scry([HUNTERS]))).toThrow();
    expect(() => engine.apply(s, scry([DRYADS]))).toThrow();
    expect(() => engine.apply(s, scry([WARRIORS, ASTROLITH]))).toThrow();
  });
});

/** The Starseer casting Celestial Doom at an enemy with the Astrolith Bearer nearby. */
describe('Celestial Conduit (153d-3737-615b-b904) and Coatl Familiar (2302-6d4-c346-7bc6)', () => {
  const field = () =>
    arena(
      { [STARSEER]: [30, 20], [ASTROLITH]: [30, 26], [WARRIORS]: [22, 24], [DRYADS]: [30, 34] },
      'hero',
    );
  const cast = (s: GameState): Action => {
    const opt = engine
      .unitOptions(s, STARSEER)
      .find((o) => o.t === 'ability' && o.kind === 'spell' && o.targets.includes(DRYADS));
    if (!opt || opt.t !== 'ability') throw new Error('the Starseer has no spell for the Dryads');
    return use(STARSEER, opt.abilityId, { target: DRYADS });
  };
  const castOf = (events: GameEvent[]) => events.find((e) => e.t === 'cast');

  it('offers both reactions when the spell is declared, before the casting roll', () => {
    const s = field();
    const declared = engine.apply(s, cast(s));
    expect(declared.events.some((e) => e.t === 'cast')).toBe(false);
    expect(engine.decision(declared.state)).toMatchObject({
      kind: 'reaction',
      player: 0,
      options: expect.arrayContaining([
        { ability: 'celestialConduit', unit: ASTROLITH, cost: 0 },
        { ability: 'coatlFamiliar', unit: STARSEER, cost: 0 },
      ]),
    });
    // Skipping both casts the spell as if nothing was offered.
    const skipped = engine.apply(declared.state, { t: 'pass' });
    expect(castOf(skipped.events)).toBeDefined();
    expect(engine.decision(skipped.state)).toMatchObject({ kind: 'main', phase: 'hero' });
  });

  it('Coatl Familiar adds a D6 to the casting roll, once per battle', () => {
    const s = field();
    const declared = engine.apply(s, cast(s));
    const used = engine.apply(declared.state, use(STARSEER, COATL_FAMILIAR_ID));
    // Conduit is still on offer; skipping it casts the spell.
    expect(engine.decision(used.state)).toMatchObject({ kind: 'reaction' });
    const done = engine.apply(used.state, { t: 'pass' });
    const ev = castOf(done.events);
    const d6 = rolls([...used.events, ...done.events], 'Coatl Familiar');
    expect(d6).toHaveLength(1);
    expect(ev).toMatchObject({ t: 'cast', unit: STARSEER });
    if (ev?.t !== 'cast') throw new Error('no cast');
    expect(ev.total).toBe(Math.max(2, ev.dice[0] + ev.dice[1] + d6[0]!));
    expect(done.state.players[0].usedOncePerBattle).toContain(`${STARSEER}:${COATL_FAMILIAR_ID}`);
    // A later spell is not offered Coatl Familiar again.
    const later = editable(done.state);
    later.units[STARSEER]!.abilitiesUsed = [];
    later.units[STARSEER]!.castsUsed = 0;
    later.units[STARSEER]!.miscast = false;
    later.players[0].spellsAttempted = [];
    const again = engine.apply(later, cast(later));
    const d = engine.decision(again.state);
    expect(d?.kind === 'reaction' ? d.options.map((o) => o.ability) : []).toEqual([
      'celestialConduit',
    ]);
  });

  it('Celestial Conduit adds 3 to control scores within 12" once the spell is cast', () => {
    const s = field();
    const objective = scenario.battlefield.objectives.find((o) => o.id === 'golden-lions-1')!;
    placeUnit(scenario, s, WARRIORS, objective.x, objective.y);
    placeUnit(scenario, s, ASTROLITH, objective.x + 7, objective.y);
    placeUnit(scenario, s, STARSEER, objective.x + 7, objective.y - 6);
    placeUnit(scenario, s, DRYADS, objective.x + 7, objective.y + 8);
    const before = controlScores(scenario, s).get(objective.id)![0];
    const declared = engine.apply(s, cast(s));
    const picked = engine.apply(declared.state, use(ASTROLITH, CELESTIAL_CONDUIT_ID));
    // Coatl Familiar is the other offer; the Conduit is not offered twice.
    const d = engine.decision(picked.state);
    expect(d?.kind === 'reaction' ? d.options.map((o) => o.ability) : []).toEqual([
      'coatlFamiliar',
    ]);
    // A successful cast gives the bonus; a failed one does not.
    const ok = applyUntil(
      engine,
      picked.state,
      { t: 'pass' },
      (x) => castOf(x.events)?.t === 'cast' && castOf(x.events)!.success,
    );
    const warriors = ok.state.units[WARRIORS]!;
    expect(effectsOf(ok.state, CELESTIAL_CONDUIT_ID)).toHaveLength(1);
    expect(conduitControlBonus(scenario, ok.state, warriors)).toBe(3);
    expect(controlScores(scenario, ok.state).get(objective.id)![0]).toBe(before + 3);
    // Not within 12" of the Bearer: nothing.
    const far = editable(ok.state);
    placeUnit(scenario, far, WARRIORS, objective.x, objective.y);
    placeUnit(scenario, far, ASTROLITH, objective.x, objective.y + 20);
    expect(conduitControlBonus(scenario, far, far.units[WARRIORS]!)).toBe(0);
    // Gone at the end of the turn.
    const over = editable(ok.state);
    clearExpiredEffects(over, 'turn');
    expect(conduitControlBonus(scenario, over, over.units[WARRIORS]!)).toBe(0);
    const failed = applyUntil(
      engine,
      picked.state,
      { t: 'pass' },
      (x) => castOf(x.events)?.t === 'cast' && !castOf(x.events)!.success,
    );
    expect(effectsOf(failed.state, CELESTIAL_CONDUIT_ID)).toHaveLength(0);
  });

  it('an unbound spell gives no Celestial Conduit effect', () => {
    // Alarielle (a Wizard in range) may unbind it.
    const t2 = arena(
      {
        [STARSEER]: [30, 20],
        [ASTROLITH]: [30, 26],
        [DRYADS]: [30, 34],
        '1:0': [30, 40],
      },
      'hero',
    );
    const declared = engine.apply(t2, cast(t2));
    const picked = engine.apply(declared.state, use(ASTROLITH, CELESTIAL_CONDUIT_ID));
    const asked = applyUntil(
      engine,
      picked.state,
      { t: 'pass' },
      (x) => castOf(x.events)?.t === 'cast' && castOf(x.events)!.success,
    );
    expect(engine.decision(asked.state)).toMatchObject({ kind: 'reaction', player: 1 });
    // Unbound: no effect.
    const unbound = applyUntil(
      engine,
      asked.state,
      { t: 'ability', unit: '1:0', abilityId: 'unbind' },
      (x) => x.events.some((e) => e.t === 'unbind' && e.unbound),
    );
    expect(effectsOf(unbound.state, CELESTIAL_CONDUIT_ID)).toHaveLength(0);
    // Not unbound: the effect arrives after the unbind roll.
    const held = applyUntil(
      engine,
      asked.state,
      { t: 'ability', unit: '1:0', abilityId: 'unbind' },
      (x) => x.events.some((e) => e.t === 'unbind' && !e.unbound),
    );
    expect(effectsOf(held.state, CELESTIAL_CONDUIT_ID)).toHaveLength(1);
  });

  it('the +3 can flip an objective at the end of the turn, before the effect is cleared', () => {
    const objective = scenario.battlefield.objectives.find((o) => o.id === 'golden-lions-1')!;
    const s = arena({ [WARRIORS]: [0, 0], [ASTROLITH]: [0, 0], [BELTHANOS]: [0, 0] }, 'end');
    placeUnit(scenario, s, WARRIORS, objective.x, objective.y);
    placeUnit(scenario, s, ASTROLITH, objective.x + 7, objective.y);
    placeUnit(scenario, s, BELTHANOS, objective.x, objective.y + 3);
    s.objectives.find((o) => o.id === objective.id)!.controller = 1;
    // Warriors lose models until the enemy leads by one or two.
    const enemy = controlScores(scenario, s).get(objective.id)![1];
    const warriors = s.units[WARRIORS]!;
    const keep = Math.max(1, enemy - 1);
    warriors.models.forEach((m, i) => {
      if (i >= keep) m.alive = false;
    });
    const mine = controlScores(scenario, s).get(objective.id)![0];
    expect(mine).toBeLessThan(enemy);
    expect(mine + 3).toBeGreaterThan(enemy);
    const without = editable(s);
    endTurn({ scenario, s: without, events: [], rng: new RngCursor(1) });
    expect(without.objectives.find((o) => o.id === objective.id)!.controller).toBe(1);
    s.effects = [
      {
        id: CELESTIAL_CONDUIT_ID,
        name: 'Celestial Conduit',
        sourceUnit: ASTROLITH,
        targetUnit: ASTROLITH,
        owner: 0,
        expires: 'turn',
      },
    ];
    endTurn({ scenario, s, events: [], rng: new RngCursor(1) });
    expect(s.objectives.find((o) => o.id === objective.id)!.controller).toBe(0);
    expect(effectsOf(s, CELESTIAL_CONDUIT_ID)).toHaveLength(0);
  });

  it('reactions are offered only for a Seraphon Wizard', () => {
    // Lord Kroak is one too, but with no Bearer or Coatl Familiar near nothing is offered.
    const s = arena({ [KROAK]: [30, 20], [DRYADS]: [30, 34] }, 'hero');
    const opt = engine
      .unitOptions(s, KROAK)
      .find((o) => o.t === 'ability' && o.kind === 'spell' && o.targets.includes(DRYADS));
    if (!opt || opt.t !== 'ability') throw new Error('Kroak has no spell for the Dryads');
    const r = engine.apply(s, use(KROAK, opt.abilityId, { target: DRYADS }));
    expect(r.events.some((e) => e.t === 'cast')).toBe(true);
  });
});
