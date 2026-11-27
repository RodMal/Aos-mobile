/** M4l: the other manifestation abilities (S13, I116 to I118), one test per ability. */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { attackModifiers, sumModifiers } from '../../rules/core/modifiers.js';
import { moveOf } from '../../rules/factions/seraphon.js';
import { allocateDamage } from '../damage.js';
import {
  clearExpiredEffects,
  createEngine,
  createScenario,
  currentPlacement,
  manifestationUnitId,
  type Engine,
  type GameEvent,
  type GameState,
  type Scenario,
  type UnitId,
  type UnitOption,
} from '../index.js';
import { oublietteAssignable, oublietteTargets, TIME_FLOW_REROLL_ID } from '../manifestations.js';
import { BOUND_FOR_THE_GREAT_OUBLIETTE_ID, MECHANISMS_OF_TIME_ID } from './manifestations.js';
import { RngCursor } from '../rng.js';
import { applyUntil, editable, keepOnly, passTo, placeUnit, startGame } from '../test-helpers.js';

const DRYADS = '0:6';
const DURTHU = '0:2';
const KROAK = '1:0';
const SAURUS_GUARD = '1:3';
const SKINKS = '1:7';

const WS_COGS = '1aba-bc38-e988-d79f';
const WS_SWORDS = '8cde-fafe-2b2a-ced5';
const WS_SUN = 'e7a5-e611-4c13-22d0';
const WS_MAELSTROM = 'e699-49b7-d2b8-d5fc';
const WS_SHACKLES = 'dee3-92a0-27e7-252a';
const SUMMON_MAELSTROM = '1f2c-ca29-2c5b-24ba';
const SUMMON_PURPLE_SUN = '1b29-60f4-48d2-a6bb';

interface World {
  scenario: Scenario;
  engine: Engine;
}

function world(): World {
  const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
  return { scenario, engine: createEngine(scenario) };
}

/** The board with only `units` left, in `owner`'s hero phase, no command points or rage dice. */
function arena(w: World, units: UnitId[], owner: 0 | 1 = 1): GameState {
  const s = editable(startGame(w.engine, 1));
  keepOnly(s, units);
  for (const p of s.players) {
    p.cp = 0;
    p.rageDice = 0;
  }
  s.active = owner;
  s.phase = 'hero';
  s.stack = [];
  return s;
}

/** Puts a manifestation on the board, one model for each of `at` (its parts). */
function addManifestation(
  w: World,
  s: GameState,
  owner: 0 | 1,
  warscroll: string,
  at: [number, number][],
  extra: { maelstrom?: number; summonedBy?: UnitId } = {},
): UnitId {
  const id = manifestationUnitId(owner, warscroll);
  const profile = w.scenario.profiles[warscroll]!;
  expect(profile.models).toHaveLength(at.length);
  s.units[id] = {
    id,
    owner,
    profileId: warscroll,
    name: profile.name,
    armyIndex: 99,
    models: at.map(([x, y]) => ({ x, y, rot: 0, alive: true })),
    damage: 0,
    status: 'battlefield',
    moved: null,
    charged: false,
    shot: false,
    fought: false,
    setUpThisTurn: false,
    isManifestation: true,
    summonedBy: extra.summonedBy ?? KROAK,
    ...(extra.maelstrom !== undefined ? { maelstrom: extra.maelstrom } : {}),
  };
  s.unitOrder.push(id);
  return id;
}

const rolls = (events: GameEvent[], label: string): number[][] =>
  events.flatMap((e) => (e.t === 'roll' && e.label === label ? [e.dice] : []));
const damage = (events: GameEvent[], source: string): number[] =>
  events.flatMap((e) => (e.t === 'damage' && e.source === source ? [e.amount] : []));

function ctxOf(w: World, s: GameState) {
  return { scenario: w.scenario, s, events: [] as GameEvent[], rng: new RngCursor(7) };
}

// ─── Chronomantic Cogs ──────────────────────────────────────────────────────────

describe('Chronomantic Cogs: Mechanisms of Time (ad92-932-6f56-1d97)', () => {
  const w = world();
  const COGS = manifestationUnitId(1, WS_COGS);
  const setup = (cogsX = 24.5): GameState => {
    const s = arena(w, [KROAK, SAURUS_GUARD, DRYADS]);
    placeUnit(w.scenario, s, KROAK, 20, 20);
    placeUnit(w.scenario, s, SAURUS_GUARD, 28, 26);
    placeUnit(w.scenario, s, DRYADS, 20, 4);
    addManifestation(w, s, 1, WS_COGS, [[cogsX, 20]]);
    return s;
  };
  const choices = (s: GameState): string[] =>
    w.engine
      .unitOptions(s, COGS)
      .flatMap((o) =>
        o.t === 'ability' && o.abilityId === MECHANISMS_OF_TIME_ID ? [o.choice!] : [],
      );

  it('is offered as a choice of two effects when a friendly Wizard is within 3", once a turn, in your hero phase', () => {
    const s = setup();
    expect(choices(s)).toEqual(['increase', 'decrease']);
    expect(choices(setup(30))).toEqual([]); // no Wizard within 3"
    const movement = editable(s);
    movement.phase = 'movement';
    expect(choices(movement)).toEqual([]);
    const used = w.engine.apply(s, {
      t: 'ability',
      unit: COGS,
      abilityId: MECHANISMS_OF_TIME_ID,
      choice: 'decrease',
    }).state;
    expect(choices(used)).toEqual([]);
    expect(() =>
      w.engine.apply(s, { t: 'ability', unit: COGS, abilityId: MECHANISMS_OF_TIME_ID }),
    ).toThrow();
  });

  it('Decrease Time Flow: -1 to hit rolls against friendly Wizards wholly within 12", until your next turn', () => {
    const s = w.engine.apply(setup(), {
      t: 'ability',
      unit: COGS,
      abilityId: MECHANISMS_OF_TIME_ID,
      choice: 'decrease',
    }).state;
    const attacker = s.units[DRYADS]!;
    const weapon = w.scenario.profiles[attacker.profileId]!.weapons[0]!;
    const hit = (target: UnitId): number =>
      sumModifiers(
        attackModifiers(w.scenario, s, {
          attacker,
          target: s.units[target]!,
          weapon,
          mode: 'fight',
        }),
        weapon,
      ).hit;
    expect(hit(KROAK)).toBe(-1); // a Wizard within 12"
    expect(hit(SAURUS_GUARD)).toBe(0); // not a Wizard
    // A Wizard that is not wholly within 12".
    const far = editable(s);
    placeUnit(w.scenario, far, KROAK, 40, 20);
    expect(
      sumModifiers(
        attackModifiers(w.scenario, far, {
          attacker,
          target: far.units[KROAK]!,
          weapon,
          mode: 'fight',
        }),
        weapon,
      ).hit,
    ).toBe(0);
    // It lasts until the start of your next turn.
    const next = editable(s);
    clearExpiredEffects(next, 'startOfNextTurn', 0);
    expect(next.effects).toHaveLength(1);
    clearExpiredEffects(next, 'startOfNextTurn', 1);
    expect(next.effects ?? []).toHaveLength(0);
  });

  it('Increase Time Flow: a charge roll of a friendly unit wholly within 12" can be re-rolled, once', () => {
    const s0 = w.engine.apply(setup(), {
      t: 'ability',
      unit: COGS,
      abilityId: MECHANISMS_OF_TIME_ID,
      choice: 'increase',
    }).state;
    const s = editable(s0);
    s.phase = 'charge';
    // The Saurus Guard declared a charge and failed its roll.
    s.units[SAURUS_GUARD]!.chargeDeclared = true;
    const reroll = (st: GameState, u: UnitId): boolean =>
      w.engine
        .unitOptions(st, u)
        .some((o) => o.t === 'ability' && o.abilityId === TIME_FLOW_REROLL_ID);
    expect(reroll(s, SAURUS_GUARD)).toBe(true);
    expect(reroll(s, KROAK)).toBe(false); // it has not charged
    const r = applyUntil(
      w.engine,
      s,
      { t: 'ability', unit: SAURUS_GUARD, abilityId: TIME_FLOW_REROLL_ID },
      (x) => x.events.some((e) => e.t === 'chargeRoll'),
    );
    expect(r.events.filter((e) => e.t === 'chargeRoll')).toHaveLength(1);
    expect(r.state.units[SAURUS_GUARD]!.chargeRerolled).toBe(true);
    expect(reroll(r.state, SAURUS_GUARD)).toBe(false); // a roll is re-rolled once
    // Outside 12" of the Cogs there is no re-roll.
    const away = editable(s);
    placeUnit(w.scenario, away, SAURUS_GUARD, 50, 40);
    expect(reroll(away, SAURUS_GUARD)).toBe(false);
    // Decrease Time Flow gives no re-roll.
    const dec = editable(
      w.engine.apply(setup(), {
        t: 'ability',
        unit: COGS,
        abilityId: MECHANISMS_OF_TIME_ID,
        choice: 'decrease',
      }).state,
    );
    dec.phase = 'charge';
    dec.units[SAURUS_GUARD]!.chargeDeclared = true;
    expect(reroll(dec, SAURUS_GUARD)).toBe(false);
  });

  describe('a charge roll is re-rolled once, by Increase Time Flow or Forward to Victory', () => {
    const failedCharge = (): GameState => {
      const s = editable(
        w.engine.apply(setup(), {
          t: 'ability',
          unit: COGS,
          abilityId: MECHANISMS_OF_TIME_ID,
          choice: 'increase',
        }).state,
      );
      s.phase = 'charge';
      s.players[1].cp = 3;
      s.units[SAURUS_GUARD]!.chargeDeclared = true;
      return s;
    };
    const has = (s: GameState, pick: (o: UnitOption) => boolean): boolean =>
      w.engine.unitOptions(s, SAURUS_GUARD).some(pick);
    const isFtV = (o: UnitOption) => o.t === 'command' && o.command === 'forwardToVictory';
    const isTimeFlow = (o: UnitOption) => o.t === 'ability' && o.abilityId === TIME_FLOW_REROLL_ID;
    const ftv = { t: 'command' as const, command: 'forwardToVictory' as const, unit: SAURUS_GUARD };

    it('Increase Time Flow first: Forward to Victory is then refused and not offered', () => {
      const s = failedCharge();
      expect(has(s, isFtV)).toBe(true);
      const r = applyUntil(
        w.engine,
        s,
        { t: 'ability', unit: SAURUS_GUARD, abilityId: TIME_FLOW_REROLL_ID },
        (x) => x.state.units[SAURUS_GUARD]!.chargeRerolled === true,
      );
      const after = editable(r.state);
      after.units[SAURUS_GUARD]!.charged = false;
      after.stack = [];
      expect(has(after, isFtV)).toBe(false);
      expect(() => w.engine.apply(after, ftv)).toThrow();
    });

    it('Forward to Victory first: Increase Time Flow is then refused and not offered', () => {
      const s = failedCharge();
      expect(has(s, isTimeFlow)).toBe(true);
      const r = w.engine.apply(s, ftv);
      const after = editable(r.state);
      after.units[SAURUS_GUARD]!.charged = false;
      after.stack = [];
      expect(after.units[SAURUS_GUARD]!.chargeRerolled).toBe(true);
      expect(has(after, isTimeFlow)).toBe(false);
      expect(() =>
        w.engine.apply(after, {
          t: 'ability',
          unit: SAURUS_GUARD,
          abilityId: TIME_FLOW_REROLL_ID,
        }),
      ).toThrow();
    });
  });

  it('the NPC picks one automatically', () => {
    const s = setup();
    s.units[KROAK]!.miscast = true; // Kroak casts nothing: the Cogs are the NPC's only option
    expect(chooseAction(w.engine, s)).toMatchObject({
      t: 'ability',
      unit: COGS,
      abilityId: MECHANISMS_OF_TIME_ID,
    });
  });
});

// ─── Quicksilver Swords ─────────────────────────────────────────────────────────

describe('Quicksilver Swords: Dancing Blades (7b11-c623-fc14-4639)', () => {
  it('no ward rolls against the damage of its attacks', () => {
    const run = (blades: boolean): GameEvent[] => {
      const w = world();
      // The Saurus Guard have a ward; the Swords attack them in the combat phase.
      const target = w.scenario.profiles[`${SAURUS_GUARD}`] ?? null;
      expect(target).toBeNull(); // profiles are keyed by profile id, not unit id
      let s = arena(w, [DURTHU, SAURUS_GUARD], 0);
      const guard = s.units[SAURUS_GUARD]!;
      w.scenario.profiles[guard.profileId] = { ...w.scenario.profiles[guard.profileId]!, ward: 4 };
      const swordsProfile = w.scenario.profiles[WS_SWORDS]!;
      if (!blades) {
        w.scenario.profiles[WS_SWORDS] = {
          ...swordsProfile,
          abilities: swordsProfile.abilities.filter((a) => a.name !== 'Dancing Blades'),
        };
      }
      placeUnit(w.scenario, s, DURTHU, 8, 8);
      placeUnit(w.scenario, s, SAURUS_GUARD, 30, 22);
      const swords = addManifestation(w, s, 0, WS_SWORDS, [[27, 22]], { summonedBy: DURTHU });
      s = passTo(w.engine, s, 'combat');
      const fight = applyUntil(w.engine, s, { t: 'fight', unit: swords }, () => true);
      const declared = fight.state;
      const d = w.engine.decision(declared);
      let t = declared;
      if (d?.kind === 'place') t = w.engine.apply(t, { t: 'pass' }).state;
      const rolled = applyUntil(w.engine, t, w.engine.defaultAction(t), (r) =>
        r.events.some((e) => e.t === 'attacks' && e.unsaved > 0),
      );
      return rolled.events;
    };
    const attack = (events: GameEvent[]) =>
      events.find((e) => e.t === 'attacks') as Extract<GameEvent, { t: 'attacks' }>;
    const withBlades = attack(run(true));
    expect(withBlades.dice.ward).toEqual([]);
    expect(withBlades.warded).toBe(0);
    expect(withBlades.damage).toBeGreaterThan(0);
    // The same attack without the ability rolls wards.
    const without = attack(run(false));
    expect(without.dice.ward!.length).toBeGreaterThan(0);
  });
});

// ─── Purple Sun of Shyish ───────────────────────────────────────────────────────

describe('Purple Sun of Shyish: Pull of the Nadir (c99-9240-9da1-d029)', () => {
  it('-1 to save rolls for friendly and enemy units within 3", and for no others', () => {
    const w = world();
    const s = arena(w, [DRYADS, SAURUS_GUARD, DURTHU, SKINKS], 1);
    placeUnit(w.scenario, s, DRYADS, 20, 20);
    placeUnit(w.scenario, s, SAURUS_GUARD, 40, 20);
    placeUnit(w.scenario, s, DURTHU, 20, 4);
    placeUnit(w.scenario, s, SKINKS, 40, 40);
    // The Sun is at the Dryads' side; the Saurus Guard are 6" away.
    const sun = addManifestation(w, s, 1, WS_SUN, [[24, 20]]);
    const save = (attacker: UnitId, target: UnitId): number => {
      const weapon = w.scenario.profiles[s.units[attacker]!.profileId]!.weapons[0]!;
      return sumModifiers(
        attackModifiers(w.scenario, s, {
          attacker: s.units[attacker]!,
          target: s.units[target]!,
          weapon,
          mode: 'fight',
        }),
        weapon,
      ).save;
    };
    expect(save(SAURUS_GUARD, DRYADS)).toBe(-1); // an enemy unit within 3"
    placeUnit(w.scenario, s, SKINKS, 26, 20);
    expect(save(DRYADS, SKINKS)).toBe(-1); // a friendly unit within 3"
    expect(save(DRYADS, SAURUS_GUARD)).toBe(0); // 3" or more from the Sun
    expect(save(DRYADS, DURTHU)).toBe(0);
    expect(save(DRYADS, sun)).toBe(0); // not the Sun itself
  });
});

// ─── Malevolent Maelstrom ───────────────────────────────────────────────────────

describe('Malevolent Maelstrom: Necrotic Vortex (c711-ce6-1fb6-7abc)', () => {
  const w = world();
  const MAELSTROM = manifestationUnitId(1, WS_MAELSTROM);

  it('gives it a maelstrom point when it is set up', () => {
    const s = arena(w, [KROAK, DRYADS]);
    placeUnit(w.scenario, s, KROAK, 35, 22);
    placeUnit(w.scenario, s, DRYADS, 10, 22);
    const r = applyUntil(
      w.engine,
      s,
      { t: 'ability', unit: KROAK, abilityId: SUMMON_MAELSTROM },
      (x) => x.events.some((e) => e.t === 'cast' && e.success),
    );
    expect(r.state.units[MAELSTROM]!.maelstrom).toBe(1);
  });

  it('gives it a point for each spell successfully cast within 12", not for those further away', () => {
    const near = arena(w, [KROAK, DRYADS]);
    placeUnit(w.scenario, near, KROAK, 20, 20);
    placeUnit(w.scenario, near, DRYADS, 10, 40);
    addManifestation(w, near, 1, WS_MAELSTROM, [[28, 20]], { maelstrom: 1 });
    const cast = (s: GameState) =>
      applyUntil(w.engine, s, { t: 'ability', unit: KROAK, abilityId: SUMMON_PURPLE_SUN }, (x) =>
        x.events.some((e) => e.t === 'cast' && e.success),
      ).state;
    expect(cast(near).units[MAELSTROM]!.maelstrom).toBe(2);
    const far = editable(near);
    placeUnit(w.scenario, far, KROAK, 6, 20);
    expect(cast(far).units[MAELSTROM]!.maelstrom).toBe(1);
    // A failed casting roll gives nothing.
    const failed = applyUntil(
      w.engine,
      near,
      { t: 'ability', unit: KROAK, abilityId: SUMMON_PURPLE_SUN },
      (x) => x.events.some((e) => e.t === 'cast' && !e.success),
    );
    expect(failed.state.units[MAELSTROM]!.maelstrom).toBe(1);
  });

  it('gives it a point for each model slain within 12", up to 6 at once', () => {
    const s = arena(w, [KROAK, DRYADS, DURTHU]);
    placeUnit(w.scenario, s, DRYADS, 20, 20);
    placeUnit(w.scenario, s, DURTHU, 20, 44);
    placeUnit(w.scenario, s, KROAK, 50, 4);
    addManifestation(w, s, 1, WS_MAELSTROM, [[26, 20]], { maelstrom: 1 });
    const ctx = ctxOf(w, s);
    const dryads = s.units[DRYADS]!;
    const health = w.scenario.profiles[dryads.profileId]!.health;
    const result = allocateDamage(ctx, dryads, health * 2, 'test');
    expect(result.slain).toBe(2);
    expect(s.units[MAELSTROM]!.maelstrom).toBe(3);
    // A model slain more than 12" away does not count.
    allocateDamage(ctx, s.units[DURTHU]!, 999, 'test');
    expect(s.units[MAELSTROM]!.maelstrom).toBe(3);
    // The most it can have is 6.
    s.units[DRYADS]!.status = 'battlefield';
    for (const m of s.units[DRYADS]!.models) m.alive = true;
    allocateDamage(ctx, s.units[DRYADS]!, health * 10, 'test');
    expect(s.units[MAELSTROM]!.maelstrom).toBe(6);
  });
});

describe('Malevolent Maelstrom: Morbid Detonation (b8a4-541-b62-cf62)', () => {
  const w = world();
  const MAELSTROM = manifestationUnitId(1, WS_MAELSTROM);
  const endOfTurn = (maelstrom: number): GameState => {
    const s = arena(w, [KROAK, DRYADS, SAURUS_GUARD, DURTHU], 0);
    placeUnit(w.scenario, s, DRYADS, 20, 20); // friendly to nobody in particular: within 9"
    placeUnit(w.scenario, s, SAURUS_GUARD, 26, 20); // within 9"
    placeUnit(w.scenario, s, KROAK, 20, 44); // beyond 9"
    placeUnit(w.scenario, s, DURTHU, 8, 4); // beyond 9"
    addManifestation(w, s, 1, WS_MAELSTROM, [[23, 20]], { maelstrom });
    s.phase = 'end';
    return s;
  };

  /** Ends the turn (the end-of-turn windows answered by default) from RNG state `rng`. */
  const endTurn = (s: GameState, rng: number) => {
    let r = w.engine.apply({ ...s, rng }, { t: 'pass' });
    const events = [...r.events];
    for (let i = 0; i < 10 && w.engine.decision(r.state)?.kind !== 'main'; i++) {
      r = w.engine.apply(r.state, w.engine.defaultAction(r.state));
      events.push(...r.events);
    }
    return { state: r.state, events };
  };

  it('with 6 maelstrom points: at the end of the turn a dice for each unit within 9", friendly and enemy, mortal damage on a 2+, then it is destroyed', () => {
    const s = endOfTurn(6);
    let r = endTurn(s, 1);
    for (let rng = 2; rng < 500; rng++) {
      const dice = rolls(r.events, 'Morbid Detonation').map((d) => d[0]!);
      if (dice.length === 2 && dice.includes(1) && dice.some((d) => d >= 2)) break;
      r = endTurn(s, rng);
    }
    const dice = rolls(r.events, 'Morbid Detonation').map((d) => d[0]!);
    expect(dice).toHaveLength(2); // the Dryads and the Saurus Guard, not Kroak or Durthu
    // Mortal damage equal to each roll of 2 or more, none on a 1.
    expect(
      damage(r.events, 'Morbid Detonation')
        .filter((a) => a > 0)
        .sort(),
    ).toEqual(dice.filter((d) => d >= 2).sort());
    expect(r.state.units[MAELSTROM]!.status).toBe('destroyed');
  });

  it('with fewer than 6 points it does nothing', () => {
    const r = endTurn(endOfTurn(5), 1);
    expect(r.events.some((e) => e.t === 'turnStart')).toBe(true);
    expect(rolls(r.events, 'Morbid Detonation')).toEqual([]);
    expect(r.state.units[MAELSTROM]!.status).toBe('battlefield');
  });
});

// ─── Soulsnare Shackles ─────────────────────────────────────────────────────────

describe('Soulsnare Shackles: Multiple Parts (9e13-160b-4a87-da4e)', () => {
  const w = world();
  const SHACKLES = manifestationUnitId(1, WS_SHACKLES);
  const PARTS: [number, number][] = [
    [20, 20],
    [23, 20],
    [26, 20],
  ];

  it('is summoned as three parts, each within 3" of another', () => {
    const s = arena(w, [KROAK, DRYADS]);
    placeUnit(w.scenario, s, KROAK, 35, 22);
    placeUnit(w.scenario, s, DRYADS, 28, 22);
    const r = applyUntil(
      w.engine,
      s,
      { t: 'ability', unit: KROAK, abilityId: 'ee70-f212-c079-a752' },
      (x) => x.events.some((e) => e.t === 'cast' && e.success),
    );
    const unit = r.state.units[SHACKLES]!;
    expect(unit.models).toHaveLength(3);
    // The suggested set-up is already legal, and so is one with the parts up to 3" apart.
    expect(w.engine.checkPlacement(r.state, currentPlacement(unit))).toEqual([]);
    const spread = currentPlacement(unit);
    spread.models = spread.models.map((m, i) => ({ ...m, x: 24 + i * 2.9, y: 17 }));
    expect(w.engine.checkPlacement(r.state, spread)).toEqual([]);
    // A part more than 3" from every other part breaks it.
    const apart = currentPlacement(unit);
    apart.models = apart.models.map((m, i) => ({ ...m, x: 24 + i * 6, y: 17 }));
    const codes = w.engine.checkPlacement(r.state, apart).map((v) => v.code);
    expect(codes).toContain('COHERENCY');
  });

  it('is destroyed with all its parts when damage points equal to its Health are allocated', () => {
    const s = arena(w, [KROAK, DRYADS]);
    placeUnit(w.scenario, s, KROAK, 35, 22);
    placeUnit(w.scenario, s, DRYADS, 10, 40);
    addManifestation(w, s, 1, WS_SHACKLES, PARTS);
    const ctx = ctxOf(w, s);
    const health = w.scenario.profiles[WS_SHACKLES]!.health;
    // Fewer points: all three parts stay, even 3" apart (more than the unit coherency of 1/2").
    const hurt = allocateDamage(ctx, s.units[SHACKLES]!, health - 1, 'test');
    expect(hurt.destroyed).toBe(false);
    expect(s.units[SHACKLES]!.models.filter((m) => m.alive)).toHaveLength(3);
    // A Maelstrom within 12" gains nothing from the parts: they are not slain one by one (I118).
    const maelstrom = addManifestation(w, s, 0, WS_MAELSTROM, [[22, 30]], { maelstrom: 1 });
    allocateDamage(ctx, s.units[SHACKLES]!, 1, 'test');
    expect(s.units[maelstrom]!.maelstrom).toBe(1);
    expect(s.units[SHACKLES]!.status).toBe('destroyed');
    expect(s.units[SHACKLES]!.models.filter((m) => m.alive)).toHaveLength(0);
  });
});

describe('Soulsnare Shackles: Bound for the Great Oubliette (6817-e507-443e-1ff4)', () => {
  const w = world();
  const SHACKLES = manifestationUnitId(1, WS_SHACKLES);
  const setup = (owner: 0 | 1 = 1): GameState => {
    const s = arena(w, [KROAK, DRYADS, DURTHU, SKINKS], owner);
    // The parts stand in a row; one enemy unit within 3" of each of the first two parts.
    placeUnit(w.scenario, s, KROAK, 10, 40);
    placeUnit(w.scenario, s, DRYADS, 20, 24);
    placeUnit(w.scenario, s, DURTHU, 24, 24);
    placeUnit(w.scenario, s, SKINKS, 50, 4);
    addManifestation(w, s, 1, WS_SHACKLES, [
      [20, 20],
      [23, 20],
      [26, 20],
    ]);
    return s;
  };
  const oublietteTargetsLeft = (st: GameState): UnitId[] =>
    oublietteTargets(w.scenario, st, st.units[SHACKLES]!);
  const use = (_s: GameState, targets: UnitId[]) => ({
    t: 'ability' as const,
    unit: SHACKLES,
    abilityId: BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
    targets,
  });

  it('assigns each target its own part within 3", and a unit only once', () => {
    expect(oublietteAssignable([['a', 'b'], ['a']], ['a', 'b'])).toBe(true);
    expect(oublietteAssignable([['a', 'b']], ['a', 'b'])).toBe(false); // one part, two units
    expect(oublietteAssignable([['a'], ['a']], ['a', 'a'])).toBe(false); // the same unit twice
    expect(oublietteAssignable([['a'], ['b']], ['c'])).toBe(false); // not within 3" of a part
  });

  it('D3 for each target: on a 2+ that much mortal damage and that much less Move for the rest of the turn', () => {
    const s = setup();
    const opt = w.engine
      .unitOptions(s, SHACKLES)
      .find((o) => o.t === 'ability' && o.abilityId === BOUND_FOR_THE_GREAT_OUBLIETTE_ID);
    expect(opt).toMatchObject({ maxTargets: 2 });
    expect(opt?.t === 'ability' && [...opt.targets].sort()).toEqual([DRYADS, DURTHU].sort());
    const r = applyUntil(w.engine, s, use(s, [DRYADS, DURTHU]), (x) => {
      const dice = rolls(x.events, 'Bound for the Great Oubliette').map((d) => d[0]!);
      return dice.length === 2 && dice[0]! >= 2 && dice[1] === 1;
    });
    const dice = rolls(r.events, 'Bound for the Great Oubliette').map((d) => d[0]!);
    // 2+ on the first target: mortal damage equal to the roll; a 1 on the second: nothing.
    expect(damage(r.events, 'Bound for the Great Oubliette')).toEqual([dice[0]]);
    const base = w.scenario.profiles[r.state.units[DRYADS]!.profileId]!.move;
    expect(moveOf(w.scenario, r.state, r.state.units[DRYADS]!)).toBe(base - dice[0]!);
    expect(moveOf(w.scenario, r.state, r.state.units[DURTHU]!)).toBe(
      w.scenario.profiles[r.state.units[DURTHU]!.profileId]!.move,
    );
    // The rest of the turn only.
    const after = editable(r.state);
    clearExpiredEffects(after, 'turn');
    expect(moveOf(w.scenario, after, after.units[DRYADS]!)).toBe(base);
    // A unit already picked this turn cannot be picked again.
    const again = w.engine
      .unitOptions(r.state, SHACKLES)
      .find((o) => o.t === 'ability' && o.abilityId === BOUND_FOR_THE_GREAT_OUBLIETTE_ID);
    expect(again).toBeUndefined();
    expect(() => w.engine.apply(r.state, use(r.state, [DRYADS]))).toThrow();
  });

  it('is used once per hero phase, in your own phase and as a reaction', () => {
    const s = setup();
    const offered = (st: GameState) =>
      w.engine
        .unitOptions(st, SHACKLES)
        .some((o) => o.t === 'ability' && o.abilityId === BOUND_FOR_THE_GREAT_OUBLIETTE_ID);
    expect(offered(s)).toBe(true);
    // Own phase: one unit picked, another still in reach, yet it is not offered again.
    const own = w.engine.apply(s, use(s, [DRYADS])).state;
    expect(oublietteTargetsLeft(own)).toContain(DURTHU);
    expect(offered(own)).toBe(false);
    expect(() => w.engine.apply(own, use(own, [DURTHU]))).toThrow();
    // The opponent's phase: the reaction is used, and then no longer offered.
    const theirs = editable(s);
    theirs.active = 0;
    const reaction = w.engine.apply(theirs, { t: 'pass' }).state;
    const used = w.engine.apply(reaction, use(reaction, [DRYADS])).state;
    const d = w.engine.decision(used);
    expect(d?.kind === 'reaction' && d.options.some((o) => o.ability === 'oubliette')).toBe(false);
    expect(() => w.engine.apply(used, use(used, [DURTHU]))).toThrow();
  });

  it('cannot pick a unit that is not within 3" of a part, or more units than parts can reach', () => {
    const s = setup();
    expect(() => w.engine.apply(s, use(s, [SKINKS]))).toThrow();
    expect(() => w.engine.apply(s, use(s, []))).toThrow();
  });

  it("in the opponent's hero phase it is a reaction, once the active player has finished", () => {
    const s = setup();
    s.active = 0; // player 0's hero phase; the Shackles belong to player 1
    const r = w.engine.apply(s, { t: 'pass' });
    const d = w.engine.decision(r.state);
    expect(d).toMatchObject({ kind: 'reaction', player: 1 });
    if (d?.kind !== 'reaction') throw new Error('no reaction');
    const offer = d.options.find((o) => o.ability === 'oubliette');
    expect(offer).toMatchObject({ unit: SHACKLES, maxTargets: 2 });
    // The NPC uses it, on units its parts can each reach.
    const action = chooseAction(w.engine, r.state);
    expect(action).toMatchObject({
      t: 'ability',
      unit: SHACKLES,
      abilityId: BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
    });
    const used = applyUntil(w.engine, r.state, use(r.state, [DRYADS, DURTHU]), (x) =>
      x.events.some((e) => e.t === 'roll' && e.label === 'Bound for the Great Oubliette'),
    );
    expect(rolls(used.events, 'Bound for the Great Oubliette')).toHaveLength(2);
  });
});
