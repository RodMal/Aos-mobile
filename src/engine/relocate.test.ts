/**
 * Sylvaneth set-up and charge abilities (task M4g): Huntmaster's Strike, Rhythm of the Chase,
 * Merciless Ambush, Shadowcreep, Realmroot Guide, Guardian Of The Glades. One block per ability,
 * with the printed limits. Printed text in data/factions/sylvaneth.json; readings in
 * docs/RULES-DECISIONS.md.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { unitGrants } from './abilities/effects.js';
import {
  GUARDIAN_OF_THE_GLADES_ID,
  HUNTMASTERS_STRIKE_ID,
  MERCILESS_AMBUSH_ID,
  REALMROOT_GUIDE_ID,
  RHYTHM_OF_THE_CHASE_ID,
  SHADOWCREEP_ID,
} from './abilities/sylvaneth.js';
import { createEngine, createScenario, type GameState } from './index.js';
import { formPlacement } from './query.js';
import type { Action, Placement, StepResult, UnitId } from './types.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const named = (s: GameState, owner: 0 | 1, name: string) =>
  Object.values(s.units).find((u) => u.owner === owner && u.name === name)!;
const BELTHANOS = 'Belthanos, First Thorn of Kurnoth';

type Phase = GameState['phase'];

/** Player 0's named units, the Wyldwood and one enemy Kroxigor, all else removed. */
function arranged(keep: string[], phase: Phase): GameState {
  const s = editable(startGame(engine, 1));
  const krox = named(s, 1, 'Kroxigor').id;
  keepOnly(s, [WYLDWOOD, krox, ...keep.map((n) => named(s, 0, n).id)]);
  placeUnit(scenario, s, WYLDWOOD, 30, 22);
  placeUnit(scenario, s, krox, 58, 40);
  s.active = 0;
  s.phase = phase;
  s.stack = [];
  s.players[0].cp = 4;
  s.players[1].cp = 4;
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return s;
}

/** A legal placement of the unit being placed, scanning a grid around `centre`. */
function legalNear(
  s: GameState,
  id: UnitId,
  centre: { x: number; y: number },
  radius = 14,
): Placement | null {
  for (let r = 0; r <= radius; r += 1) {
    for (let a = 0; a < 360; a += 20) {
      const x = centre.x + Math.cos((a * Math.PI) / 180) * r;
      const y = centre.y + Math.sin((a * Math.PI) / 180) * r;
      const p = formPlacement(scenario, s.units[id]!, { x, y }, 0);
      if (engine.checkPlacement(s, p).length === 0) return p;
    }
  }
  return null;
}

const at = (s: GameState, id: UnitId, x: number, y: number): Placement =>
  formPlacement(scenario, s.units[id]!, { x, y }, 0);
const codes = (s: GameState, p: Placement): string[] =>
  engine.checkPlacement(s, p).map((v) => v.code);
const centreOf = (s: GameState, id: UnitId) => {
  const ms = s.units[id]!.models.filter((m) => m.alive);
  return {
    x: ms.reduce((n, m) => n + m.x, 0) / ms.length,
    y: ms.reduce((n, m) => n + m.y, 0) / ms.length,
  };
};
const hasOption = (s: GameState, unit: UnitId, abilityId: string) =>
  engine.unitOptions(s, unit).some((o) => o.t === 'ability' && o.abilityId === abilityId);

describe("Huntmaster's Strike (61d2-55e1-7873-e100)", () => {
  /** Belthanos charged this turn; the end phase is next. */
  function charged(): GameState {
    const s = arranged([BELTHANOS], 'end');
    const b = named(s, 0, BELTHANOS).id;
    placeUnit(scenario, s, b, 30, 30);
    s.units[b]!.charged = true;
    return s;
  }
  const offered = (s: GameState) => {
    const r = engine.apply(s, { t: 'pass' }).state;
    return { state: r, d: engine.decision(r) };
  };
  const use = (s: GameState, id: UnitId): Action => ({
    t: 'ability',
    unit: id,
    abilityId: HUNTMASTERS_STRIKE_ID,
  });

  it('is offered at the end of the turn to a unit that charged', () => {
    const s = charged();
    const b = named(s, 0, BELTHANOS).id;
    const { d } = offered(s);
    expect(d).toMatchObject({ kind: 'reaction', player: 0 });
    if (d?.kind !== 'reaction') return;
    expect(d.options).toEqual([{ ability: 'huntmastersStrike', unit: b, cost: 0 }]);
    // A unit that did not charge has no such offer.
    const idle = charged();
    idle.units[b]!.charged = false;
    expect(offered(idle).d?.kind).not.toBe('reaction');
  });

  it('sets the unit up again wholly within the creeping overgrowth, more than 6" from enemies', () => {
    const { state } = offered(charged());
    const b = named(state, 0, BELTHANOS).id;
    const r = engine.apply(state, use(state, b));
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'relocate', unit: b });

    // Outside the creeping overgrowth (the Wyldwood reaches 6"): refused.
    expect(codes(r.state, at(r.state, b, 8, 8))).toContain('OUTSIDE_TERRITORY');
    // Within the overgrowth but within 6" of an enemy: refused.
    const good = legalNear(r.state, b, { x: 30, y: 22 })!;
    expect(good).not.toBeNull();
    const near = editable(r.state);
    placeUnit(
      scenario,
      near,
      named(near, 1, 'Kroxigor').id,
      good.models[0]!.x + 4,
      good.models[0]!.y,
    );
    expect(codes(near, good)).toContain('ENEMY_COMBAT_RANGE');
    // The same spot with the enemy well clear is fine.
    const far = editable(r.state);
    placeUnit(
      scenario,
      far,
      named(far, 1, 'Kroxigor').id,
      good.models[0]!.x + 16,
      good.models[0]!.y,
    );
    expect(codes(far, good)).not.toContain('ENEMY_COMBAT_RANGE');

    const done = engine.apply(r.state, { t: 'place', placement: good });
    expect(done.state.units[b]!.models[0]!.x).toBeCloseTo(good.models[0]!.x);
    expect(done.state.units[b]!.moved).toBeNull();
  });

  it('may be declined at the set-up, leaving the unit where it stands and the use unspent', () => {
    const { state } = offered(charged());
    const b = named(state, 0, BELTHANOS).id;
    const r = engine.apply(state, use(state, b));
    const before = { ...state.units[b]!.models[0]! };
    const back = engine.apply(r.state, { t: 'pass' }).state;
    expect(back.units[b]!.models[0]!.x).toBeCloseTo(before.x);
    expect(back.players[0].usedOncePerTurn ?? []).not.toContain(HUNTMASTERS_STRIKE_ID);
  });
});

describe('Rhythm of the Chase (b29c-dd1a-502d-27c4)', () => {
  /** The start of player 0's combat phase, Belthanos in combat with the Kroxigor. */
  function fighting(): GameState {
    const s = arranged([BELTHANOS], 'charge');
    const b = named(s, 0, BELTHANOS).id;
    const krox = named(s, 1, 'Kroxigor').id;
    placeUnit(scenario, s, b, 30, 30, 90);
    placeUnit(scenario, s, krox, 30 + 4, 30, 270);
    return engine.apply(s, { t: 'pass' }).state;
  }
  const use = (s: GameState): Action => ({
    t: 'ability',
    unit: named(s, 0, BELTHANOS).id,
    abilityId: RHYTHM_OF_THE_CHASE_ID,
    target: named(s, 1, 'Kroxigor').id,
  });
  const rolled = (r: StepResult): number | undefined => {
    const e = r.events.find((x) => x.t === 'roll' && x.label === 'Rhythm of the Chase');
    return e?.t === 'roll' ? e.dice[0] : undefined;
  };

  it('is offered at the start of the combat phase, before units are picked to fight', () => {
    const s = fighting();
    expect(s.phase).toBe('combat');
    expect(engine.decision(s)).toMatchObject({
      kind: 'reaction',
      player: 0,
      trigger: 'start:combat',
      options: [
        {
          ability: 'rhythmOfTheChase',
          unit: named(s, 0, BELTHANOS).id,
          targets: [named(s, 1, 'Kroxigor').id],
        },
      ],
    });
    // Passing moves on to picking fighters, where it is no longer offered (only FIGHT abilities are).
    const picked = engine.apply(s, { t: 'pass' }).state;
    expect(engine.decision(picked)).toMatchObject({ kind: 'fightPick', player: 0 });
    expect(hasOption(picked, named(picked, 0, BELTHANOS).id, RHYTHM_OF_THE_CHASE_ID)).toBe(false);
    expect(() => engine.apply(picked, use(picked))).toThrow();
  });

  it('is not offered against an enemy unit that is not in combat with the unit', () => {
    const s = arranged([BELTHANOS], 'charge');
    placeUnit(scenario, s, named(s, 0, BELTHANOS).id, 30, 30, 90);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, 50, 30, 270);
    const started = engine.apply(s, { t: 'pass' }).state;
    expect(engine.decision(started)?.kind).not.toBe('reaction');
  });

  it('on a 2+ inflicts that much mortal damage, then sets up within 1" of the target', () => {
    const s = fighting();
    const b = named(s, 0, BELTHANOS).id;
    const krox = named(s, 1, 'Kroxigor').id;
    const r = applyUntil(engine, s, use(s), (x) => (rolled(x) ?? 0) >= 2);
    const roll = rolled(r)!;
    expect(r.state.units[krox]!.damage).toBe(roll);
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'relocate', unit: b });
    // Far from the target: refused. Within 1" of it: allowed.
    const k = centreOf(r.state, krox);
    expect(codes(r.state, at(r.state, b, 8, 8))).toContain('TOO_FAR');
    const good = legalNear(r.state, b, { x: k.x, y: k.y - 4 }, 8);
    expect(good).not.toBeNull();
    const done = engine.apply(r.state, { t: 'place', placement: good! });
    expect(done.state.units[b]!.models[0]!.x).toBeCloseTo(good!.models[0]!.x);
    expect(done.state.units[b]!.moved).toBeNull();
    // Once per turn for the army, and back to picking fighters.
    expect(done.state.players[0].usedOncePerTurn).toContain(RHYTHM_OF_THE_CHASE_ID);
    expect(engine.decision(done.state)?.kind).toBe('fightPick');
  });

  it('on a 1 does nothing', () => {
    const s = fighting();
    const r = applyUntil(engine, s, use(s), (x) => rolled(x) === 1);
    expect(r.state.units[named(s, 1, 'Kroxigor').id]!.damage).toBe(0);
    expect(engine.decision(r.state)?.kind).toBe('fightPick');
    expect(r.state.players[0].usedOncePerTurn).toContain(RHYTHM_OF_THE_CHASE_ID);
  });
});

describe('Merciless Ambush (77b2-7e2-ba0c-83a1)', () => {
  const DRYCHA = 'Drycha Hamadreth';
  /** Drycha stands near the Wyldwood; the Kroxigor is `gap` inches away from it, east of it. */
  function ambush(krox: { x: number; y: number }): GameState {
    const s = arranged([DRYCHA], 'charge');
    placeUnit(scenario, s, named(s, 0, DRYCHA).id, 30, 30);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, krox.x, krox.y);
    return s;
  }
  const use = (s: GameState): Action => ({
    t: 'command',
    command: 'mercilessAmbush',
    unit: named(s, 0, DRYCHA).id,
  });
  const confirm = (s: GameState): Action => ({
    t: 'ability',
    unit: named(s, 0, DRYCHA).id,
    abilityId: MERCILESS_AMBUSH_ID,
  });
  const chargeDice = (r: StepResult): number => {
    const e = r.events.find((x) => x.t === 'chargeRoll');
    return e?.t === 'chargeRoll' ? e.dice[0] + e.dice[1] : 0;
  };

  it('asks to confirm first: nothing is paid or rolled until then, and cancelling costs nothing', () => {
    const s = ambush({ x: 40, y: 22 });
    const d = named(s, 0, DRYCHA).id;
    const asked = engine.apply(s, use(s));
    expect(asked.events.some((e) => e.t === 'chargeRoll')).toBe(false);
    expect(asked.state.players[0].cp).toBe(4);
    expect(engine.decision(asked.state)).toMatchObject({
      kind: 'reaction',
      player: 0,
      options: [{ ability: 'mercilessAmbush', unit: d }],
    });
    // Cancel: the command is still there, unpaid, and the unit has not declared a charge.
    const back = engine.apply(asked.state, { t: 'pass' });
    expect(back.state.players[0].cp).toBe(4);
    expect(back.state.units[d]!.chargeDeclared).toBe(false);
    expect(engine.decision(back.state)).toMatchObject({ kind: 'main', phase: 'charge' });
    expect(engine.unitOptions(back.state, d)).toContainEqual({
      t: 'command',
      command: 'mercilessAmbush',
      cost: 1,
    });
    // Confirm: the command is paid and the dice are rolled.
    const sure = engine.apply(asked.state, confirm(s));
    expect(sure.state.players[0].cp).toBe(3);
    expect(sure.events.some((e) => e.t === 'chargeRoll')).toBe(true);
  });

  it('is a command of the charge phase for a unit not in combat that has not run', () => {
    const s = ambush({ x: 30, y: 8 });
    const d = named(s, 0, DRYCHA).id;
    expect(engine.unitOptions(s, d)).toContainEqual({
      t: 'command',
      command: 'mercilessAmbush',
      cost: 1,
    });
    const ran = editable(s);
    ran.units[d]!.moved = 'run';
    expect(engine.unitOptions(ran, d).some((o) => o.t === 'command')).toBe(false);
    const fighting = editable(s);
    placeUnit(scenario, fighting, named(fighting, 1, 'Kroxigor').id, 34, 30);
    expect(
      engine
        .unitOptions(fighting, d)
        .some((o) => o.t === 'command' && o.command === 'mercilessAmbush'),
    ).toBe(false);
  });

  it('sets up within 1/2" of an enemy and wholly within X" of a feature with an overgrown token', () => {
    // The enemy stands beside the Wyldwood, so a big enough roll reaches it.
    const s = ambush({ x: 40, y: 22 });
    const d = named(s, 0, DRYCHA).id;
    const asked = engine.apply(s, use(s)).state;
    const r = applyUntil(engine, asked, confirm(s), (x) => chargeDice(x) >= 9);
    const x = chargeDice(r);
    expect(r.state.players[0].cp).toBe(3);
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'relocate', unit: d });
    expect(r.state.units[d]!.chargeDeclared).toBe(true);

    const k = centreOf(r.state, named(r.state, 1, 'Kroxigor').id);
    const good = legalNear(r.state, d, { x: k.x - 2, y: k.y }, 8);
    expect(good).not.toBeNull();
    // Beside the enemy but not within X of the Wyldwood (the enemy is 9" or more from it): refused.
    const faraway = editable(r.state);
    placeUnit(scenario, faraway, named(faraway, 1, 'Kroxigor').id, 30 + x + 12, 22);
    const fk = centreOf(faraway, named(faraway, 1, 'Kroxigor').id);
    expect(codes(faraway, at(faraway, d, fk.x - 2, fk.y))).toContain('TOO_FAR');
    // Near the Wyldwood but not within 1/2" of any enemy: refused.
    expect(codes(r.state, at(r.state, d, 30, 28))).toContain('NOT_IN_CHARGE_RANGE');

    const done = engine.apply(r.state, { t: 'place', placement: good! });
    expect(done.state.units[d]!.charged).toBe(true);
    expect(done.state.units[d]!.moved).toBeNull();
  });
});

describe('Shadowcreep (76b2-ce61-8aec-f6c1)', () => {
  const SPITES = 'Spite-Revenants';
  function movement(): GameState {
    const s = arranged([SPITES], 'movement');
    placeUnit(scenario, s, named(s, 0, SPITES).id, 30, 27);
    return s;
  }
  const use = (s: GameState): Action => ({
    t: 'ability',
    unit: named(s, 0, SPITES).id,
    abilityId: SHADOWCREEP_ID,
  });

  it('needs the unit wholly within the creeping overgrowth', () => {
    const s = movement();
    const id = named(s, 0, SPITES).id;
    expect(hasOption(s, id, SHADOWCREEP_ID)).toBe(true);
    const out = editable(s);
    placeUnit(scenario, out, id, 8, 8);
    expect(hasOption(out, id, SHADOWCREEP_ID)).toBe(false);
  });

  it('sets up wholly within 3" of terrain and more than 9" from enemies, then +1 to charge rolls', () => {
    const s = movement();
    const id = named(s, 0, SPITES).id;
    const r = engine.apply(s, use(s));
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'relocate', unit: id });
    // Beside a battlefield terrain feature: allowed.
    const feature = scenario.battlefield.terrain.find((t) => t.centre[0] > 4)!;
    const near = legalNear(r.state, id, { x: feature.centre[0], y: feature.centre[1] }, 10);
    expect(near).not.toBeNull();
    // A spot more than 3" from every terrain feature is refused.
    const bare = (() => {
      for (let x = 4; x < 56; x += 2) {
        for (let y = 4; y < 40; y += 2) {
          const p = at(r.state, id, x, y);
          if (codes(r.state, p).length === 0) return p;
          if (codes(r.state, p).length === 1 && codes(r.state, p)[0] === 'TOO_FAR') {
            return p;
          }
        }
      }
      return null;
    })();
    expect(bare).not.toBeNull();
    expect(codes(r.state, bare!)).toEqual(['TOO_FAR']);
    // Within 9" of an enemy: refused.
    const crowded = editable(r.state);
    placeUnit(
      scenario,
      crowded,
      named(crowded, 1, 'Kroxigor').id,
      near!.models[0]!.x + 5,
      near!.models[0]!.y,
    );
    expect(codes(crowded, near!)).toContain('ENEMY_COMBAT_RANGE');

    const done = engine.apply(r.state, { t: 'place', placement: near! });
    expect(unitGrants(scenario, done.state, done.state.units[id]!).chargeRollModifier).toBe(1);
    expect(hasOption(done.state, id, SHADOWCREEP_ID)).toBe(false);
  });

  it('a unit set up again cannot move in the movement phase of that turn (Core 24.0), but can pile in', () => {
    const s = movement();
    const id = named(s, 0, SPITES).id;
    const moveKinds = (st: GameState) => engine.unitOptions(st, id).filter((o) => o.t === 'move');
    expect(moveKinds(s).length).toBeGreaterThan(0);
    const r = engine.apply(s, use(s));
    const near = legalNear(
      r.state,
      id,
      { x: scenario.battlefield.terrain.find((f) => f.centre[0] > 4)!.centre[0], y: 22 },
      14,
    );
    const done = engine.apply(r.state, { t: 'place', placement: near! }).state;
    expect(done.units[id]!.setUpThisTurn).toBe(true);
    expect(moveKinds(done)).toEqual([]);
    // Declining the set-up leaves the unit free to move.
    const declined = engine.apply(engine.apply(s, use(s)).state, { t: 'pass' }).state;
    expect(moveKinds(declined).length).toBeGreaterThan(0);
    // The next turn it moves again.
    const later = editable(done);
    later.units[id]!.setUpThisTurn = false;
    expect(moveKinds(later).length).toBeGreaterThan(0);
  });

  it('is taken back when the set-up is declined', () => {
    const s = movement();
    const r = engine.apply(s, use(s));
    const back = engine.apply(r.state, { t: 'pass' }).state;
    expect(hasOption(back, named(back, 0, SPITES).id, SHADOWCREEP_ID)).toBe(true);
  });
});

describe('Realmroot Guide (c133-8f0c-936d-30d3)', () => {
  const GUIDE = 'Warsong Revenant';
  function movement(): GameState {
    const s = arranged([GUIDE, 'Dryads'], 'movement');
    placeUnit(scenario, s, named(s, 0, GUIDE).id, 30, 28);
    placeUnit(scenario, s, named(s, 0, 'Dryads').id, 30, 31);
    return s;
  }
  const guide = (s: GameState) => named(s, 0, GUIDE).id;
  const dryads = (s: GameState) => named(s, 0, 'Dryads').id;

  it('is offered alone and with another friendly Sylvaneth unit within combat range', () => {
    const s = movement();
    const options = engine
      .unitOptions(s, guide(s))
      .filter((o) => o.t === 'ability' && o.abilityId === REALMROOT_GUIDE_ID);
    expect(options).toHaveLength(2);
    expect(options.map((o) => (o.t === 'ability' ? o.targets : []))).toEqual([[], [dryads(s)]]);
    // Dryads out of range: only alone.
    const apart = editable(s);
    placeUnit(scenario, apart, dryads(apart), 30, 16);
    expect(engine.unitOptions(apart, guide(apart)).filter((o) => o.t === 'ability')).toHaveLength(
      1,
    );
    // Not wholly within the overgrowth: not offered.
    const out = editable(s);
    placeUnit(scenario, out, guide(out), 8, 8);
    expect(hasOption(out, guide(out), REALMROOT_GUIDE_ID)).toBe(false);
  });

  it('sets up this unit and the other wholly within the overgrowth, more than 9" from enemies', () => {
    const s = movement();
    const g = guide(s);
    const dr = dryads(s);
    const r = engine.apply(s, { t: 'ability', unit: g, abilityId: REALMROOT_GUIDE_ID, target: dr });
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'relocate', unit: g });
    expect(codes(r.state, at(r.state, g, 8, 8))).toContain('OUTSIDE_TERRITORY');
    const crowded = editable(r.state);
    const spot = legalNear(r.state, g, { x: 30, y: 22 })!;
    expect(spot).not.toBeNull();
    placeUnit(
      scenario,
      crowded,
      named(crowded, 1, 'Kroxigor').id,
      spot.models[0]!.x + 6,
      spot.models[0]!.y,
    );
    expect(codes(crowded, spot)).toContain('ENEMY_COMBAT_RANGE');

    const first = engine.apply(r.state, { t: 'place', placement: spot });
    expect(engine.decision(first.state)).toMatchObject({
      kind: 'place',
      reason: 'relocate',
      unit: dr,
    });
    const second = legalNear(first.state, dr, { x: 30, y: 22 })!;
    expect(second).not.toBeNull();
    const done = engine.apply(first.state, { t: 'place', placement: second });
    expect(done.state.stack).toHaveLength(0);
    // Once per battle.
    expect(hasOption(done.state, g, REALMROOT_GUIDE_ID)).toBe(false);
    const nextTurn = editable(done.state);
    nextTurn.players[0].usedOncePerTurn = [];
    expect(hasOption(nextTurn, g, REALMROOT_GUIDE_ID)).toBe(false);
  });

  it('is taken back, with the other unit, when the first set-up is declined', () => {
    const s = movement();
    const r = engine.apply(s, {
      t: 'ability',
      unit: guide(s),
      abilityId: REALMROOT_GUIDE_ID,
      target: dryads(s),
    });
    const back = engine.apply(r.state, { t: 'pass' }).state;
    expect(back.stack).toHaveLength(0);
    expect(hasOption(back, guide(back), REALMROOT_GUIDE_ID)).toBe(true);
  });
});

describe('Guardian Of The Glades (ea9f-5c5b-8b97-78aa)', () => {
  const DURTHU = 'Spirit of Durthu';
  /**
   * Belthanos (a Sylvaneth Hero) fights the Kroxigor; Durthu stands 9" from it, and a second
   * enemy, Saurus Guard, stands in his way that is not in combat with a Hero.
   */
  function charging(): GameState {
    const s = arranged([DURTHU, BELTHANOS], 'charge');
    const guard = named(s, 1, 'Saurus Guard');
    s.units[guard.id]!.status = 'battlefield';
    for (const m of s.units[guard.id]!.models) m.alive = true;
    placeUnit(scenario, s, named(s, 0, BELTHANOS).id, 20, 20, 90);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, 24, 20, 270);
    placeUnit(scenario, s, guard.id, 36, 30, 0);
    placeUnit(scenario, s, named(s, 0, DURTHU).id, 24, 30, 0);
    return s;
  }
  const durthu = (s: GameState) => named(s, 0, DURTHU).id;
  const declare = (s: GameState): Action => ({
    t: 'ability',
    unit: durthu(s),
    abilityId: GUARDIAN_OF_THE_GLADES_ID,
  });

  it('is offered with a charge, when an enemy is in combat with another friendly Sylvaneth Hero', () => {
    const s = charging();
    expect(hasOption(s, durthu(s), GUARDIAN_OF_THE_GLADES_ID)).toBe(true);
    const alone = editable(s);
    placeUnit(scenario, alone, named(alone, 0, BELTHANOS).id, 8, 8);
    expect(hasOption(alone, durthu(alone), GUARDIAN_OF_THE_GLADES_ID)).toBe(false);
  });

  it('adds 2 to the charge roll and the charge must end within 1/2" of the enemy fighting the Hero', () => {
    const s = charging();
    const d = durthu(s);
    const krox = named(s, 1, 'Kroxigor').id;
    const guard = named(s, 1, 'Saurus Guard').id;
    const r = applyUntil(engine, s, declare(s), (x) => engine.decision(x.state)?.kind === 'place');
    expect(unitGrants(scenario, r.state, r.state.units[d]!).chargeRollModifier).toBe(2);
    const roll = r.events.find((e) => e.t === 'chargeRoll');
    expect(roll).toBeTruthy();
    expect(engine.decision(r.state)).toMatchObject({ kind: 'place', reason: 'charge', unit: d });
    expect(r.state.players[0].usedOncePerTurn).toContain(GUARDIAN_OF_THE_GLADES_ID);

    // Ending beside the Saurus Guard (not in combat with a Hero) is refused...
    const g = centreOf(r.state, guard);
    const k = centreOf(r.state, krox);
    // Some spot within 1/2" of the Guard exists on the grid; with the restriction it is refused.
    const free = editable(r.state);
    free.effects = [];
    let besideGuard: Placement | null = null;
    for (let dx = 1; dx <= 10 && !besideGuard; dx += 0.25) {
      const p = at(free, d, g.x - dx, g.y);
      if (!codes(free, p).includes('NOT_IN_CHARGE_RANGE')) besideGuard = p;
    }
    expect(besideGuard).not.toBeNull();
    expect(codes(r.state, besideGuard!)).toContain('NOT_IN_CHARGE_RANGE');
    // ...and the check accepts a charge that ends within 1/2" of the Kroxigor, if it can reach.
    const reach = r.events.find((e) => e.t === 'chargeRoll');
    expect(reach).toBeTruthy();
    const beside = at(r.state, d, k.x, k.y + 6);
    expect(codes(r.state, beside)).not.toContain('NOT_IN_CHARGE_RANGE');
  });

  it('the charge roll only counts the enemy units in combat with a Hero', () => {
    const s = charging();
    // The Kroxigor (fighting Belthanos) is far off; the Guard is close and not in combat with a Hero.
    placeUnit(scenario, s, named(s, 0, BELTHANOS).id, 45, 25, 90);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, 45, 21, 270);
    placeUnit(scenario, s, named(s, 1, 'Saurus Guard').id, 45, 11, 0);
    placeUnit(scenario, s, durthu(s), 45, 4, 0);
    const chargeRoll = (r: StepResult) => r.events.find((e) => e.t === 'chargeRoll');
    let failedWithGuardInReach = 0;
    let plainReachedGuard = 0;
    for (let rng = 1; rng < 200; rng++) {
      const e = chargeRoll(engine.apply({ ...s, rng }, declare(s)));
      if (e?.t !== 'chargeRoll') continue;
      const total = e.dice[0] + e.dice[1] + 2;
      // A roll of 7+ would reach the Guard, but only the Kroxigor counts.
      if (total >= 7 && !e.success) failedWithGuardInReach++;
      const plain = chargeRoll(engine.apply({ ...s, rng }, { t: 'charge', unit: durthu(s) }));
      if (plain?.t === 'chargeRoll' && plain.success) plainReachedGuard++;
    }
    expect(failedWithGuardInReach).toBeGreaterThan(0);
    expect(plainReachedGuard).toBeGreaterThan(0);
  });

  it('is once per turn for the army', () => {
    const s = charging();
    const r = applyUntil(engine, s, declare(s), (x) => engine.decision(x.state)?.kind === 'place');
    const back = engine.apply(r.state, { t: 'pass' }).state;
    expect(hasOption(back, durthu(back), GUARDIAN_OF_THE_GLADES_ID)).toBe(false);
  });
});

describe('Merciless Ambush and Forward to Victory', () => {
  it('a declined Merciless Ambush cannot be turned into a normal charge', () => {
    const s = arranged(['Drycha Hamadreth'], 'charge');
    const d = named(s, 0, 'Drycha Hamadreth').id;
    placeUnit(scenario, s, d, 30, 30);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, 40, 22);
    const asked = engine.apply(s, { t: 'command', command: 'mercilessAmbush', unit: d }).state;
    const r = engine.apply(asked, {
      t: 'ability',
      unit: d,
      abilityId: MERCILESS_AMBUSH_ID,
    });
    const declined = engine.apply(r.state, { t: 'pass' }).state;
    expect(declined.units[d]!.charged).toBe(false);
    const options = engine.unitOptions(declined, d);
    expect(options.some((o) => o.t === 'command' && o.command === 'forwardToVictory')).toBe(false);
    expect(options.some((o) => o.t === 'charge')).toBe(false);
    expect(() =>
      engine.apply(declined, { t: 'command', command: 'forwardToVictory', unit: d }),
    ).toThrow();
  });
});
