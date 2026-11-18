/**
 * Lord Kroak (Supreme Master of Order 244b-f6f2-322d-5345, Arcane Vassal 6bfc-5f30-ec02-307,
 * Dead for Innumerable Ages c5a7-920c-9ff8-652) and the Sunclaw Starhost's Vengeance of Azyr
 * (7c7e-3757-9881-5bd7). Readings: docs/RULES-DECISIONS.md I82 to I88.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import {
  createEngine,
  createScenario,
  type Action,
  type GameEvent,
  type GameState,
  type UnitId,
} from '../index.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from '../test-helpers.js';
import { eligibleUnbinders, manifestationUnitId } from './magic.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const ALARIELLE = '0:0';
const DRYADS = '0:6';
const KROAK = '1:0';
const KROXIGOR = '1:1';
const SAURUS_WARRIORS = '1:5';
const STARSEER = '1:6';

const CELESTIAL_DELIVERANCE = 'f7bf-5a9-2828-a74';
const ARCANE_VASSAL = '6bfc-5f30-ec02-307';
const SUMMON_PENDULUM = '678b-96e1-66bb-1de8';
const WS_PENDULUM = 'fcb6-ae80-2e58-aadb';

type At = Record<string, [number, number]>;

/** `units` only, at the given places, in a player's hero phase, with no rage dice. */
function arena(units: UnitId[], at: At, active: 0 | 1 = 1): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, units);
  for (const id of units) placeUnit(scenario, s, id, at[id]![0], at[id]![1]);
  s.active = active;
  s.turnIndex = 0;
  s.phase = 'hero';
  s.stack = [];
  for (const p of s.players) {
    p.cp = 4;
    p.rageDice = 0;
  }
  return s;
}

const events = <T extends GameEvent['t']>(list: GameEvent[], t: T) =>
  list.filter((e): e is Extract<GameEvent, { t: T }> => e.t === t);

/** Answers whatever is pending with the engine's default until a main decision. */
function settleDefaults(s0: GameState, max = 12): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    const d = engine.decision(s);
    if (!d || d.kind === 'main') break;
    s = engine.apply(s, engine.defaultAction(s)).state;
  }
  return s;
}

const spellOf = (s: GameState, unit: UnitId) => {
  const o = engine.unitOptions(s, unit).find((x) => x.t === 'ability' && x.kind === 'spell');
  if (!o || o.t !== 'ability') throw new Error(`${unit} has no spell`);
  return o;
};

describe('Supreme Master of Order (244b-f6f2-322d-5345)', () => {
  it('adds 2 to Kroak casting rolls', () => {
    const s = arena([KROAK, DRYADS], { [KROAK]: [30, 22], [DRYADS]: [20, 22] });
    const r = applyUntil(
      engine,
      s,
      { t: 'ability', unit: KROAK, abilityId: CELESTIAL_DELIVERANCE, target: DRYADS },
      (x) => x.events.some((e) => e.t === 'cast' && e.dice[0] + e.dice[1] === 6),
    );
    const cast = events(r.events, 'cast')[0]!;
    expect(cast.total).toBe(8);
    expect(cast.success).toBe(true);
  });

  it('adds 1 to Kroak unbinding rolls, and he may unbind a Wizard anywhere on the battlefield', () => {
    // Alarielle is 60" from Kroak: out of the usual 30".
    const s = arena(
      [ALARIELLE, KROAK, SAURUS_WARRIORS],
      { [ALARIELLE]: [4, 22], [SAURUS_WARRIORS]: [14, 22], [KROAK]: [64, 22] },
      0,
    );
    expect(eligibleUnbinders(scenario, s, s.units[ALARIELLE]!).map((u) => u.id)).toEqual([KROAK]);
    const o = spellOf(s, ALARIELLE);
    const cast = applyUntil(
      engine,
      s,
      {
        t: 'ability',
        unit: ALARIELLE,
        abilityId: o.abilityId,
        ...(o.targets[0] ? { target: o.targets[0] } : {}),
      },
      (r) => r.events.some((e) => e.t === 'cast' && e.success && e.total <= 9),
    );
    expect(engine.decision(cast.state)?.kind).toBe('reaction');
    const unbind = applyUntil(
      engine,
      cast.state,
      { t: 'ability', unit: KROAK, abilityId: 'unbind' },
      (r) => r.events.some((e) => e.t === 'unbind' && e.dice[0] + e.dice[1] === 6),
    );
    expect(events(unbind.events, 'unbind')[0]).toMatchObject({ total: 7, unit: KROAK });
  });

  it('does not extend the unbind range of other Wizards', () => {
    const s = arena(
      [ALARIELLE, STARSEER, SAURUS_WARRIORS],
      { [ALARIELLE]: [4, 22], [SAURUS_WARRIORS]: [14, 22], [STARSEER]: [64, 22] },
      0,
    );
    expect(eligibleUnbinders(scenario, s, s.units[ALARIELLE]!)).toEqual([]);
  });

  it('adds 1 to banishment rolls and lets Kroak banish a manifestation anywhere', () => {
    const s0 = arena(
      [ALARIELLE, KROAK, DRYADS],
      { [ALARIELLE]: [12, 22], [DRYADS]: [14, 30], [KROAK]: [64, 22] },
      0,
    );
    // Alarielle summons a Pendulum (Kroak may unbind it from anywhere: he declines); it is then
    // moved 60" from Kroak.
    const summoned = applyUntil(
      engine,
      s0,
      { t: 'ability', unit: ALARIELLE, abilityId: SUMMON_PENDULUM },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    const s = editable(settleDefaults(summoned.state));
    const id = manifestationUnitId(0, WS_PENDULUM);
    expect(s.units[id]?.status).toBe('battlefield');
    placeUnit(scenario, s, id, 4, 4);
    s.active = 1;
    s.phase = 'hero';
    s.stack = [];
    const opt = engine.unitOptions(s, KROAK).find((o) => o.t === 'ability' && o.kind === 'banish');
    expect(opt).toMatchObject({ targets: [id] });
    const r = applyUntil(
      engine,
      s,
      { t: 'ability', unit: KROAK, abilityId: 'banish', target: id },
      (x) => x.events.some((e) => e.t === 'banish' && e.dice[0] + e.dice[1] === 6),
    );
    expect(events(r.events, 'banish')[0]).toMatchObject({ total: 7, banished: true });
    expect(r.state.units[id]!.status).toBe('destroyed');
  });
});

describe('Arcane Vassal (6bfc-5f30-ec02-307)', () => {
  const at: At = { [KROAK]: [35, 22], [STARSEER]: [22, 22], [DRYADS]: [6, 22] };
  const vassal = (): Action => ({
    t: 'ability',
    unit: KROAK,
    abilityId: ARCANE_VASSAL,
    target: STARSEER,
  });
  const celestial = (st: GameState) =>
    engine
      .unitOptions(st, KROAK)
      .find((o) => o.t === 'ability' && o.abilityId === CELESTIAL_DELIVERANCE);

  it('offers the friendly Skink Wizards wholly within 18", once per turn', () => {
    const s = arena([KROAK, STARSEER, DRYADS], at);
    const opt = engine
      .unitOptions(s, KROAK)
      .find((o) => o.t === 'ability' && o.abilityId === ARCANE_VASSAL);
    expect(opt).toMatchObject({ kind: 'activated', targets: [STARSEER] });
    const used = engine.apply(s, vassal()).state;
    expect(
      engine
        .unitOptions(used, KROAK)
        .some((o) => o.t === 'ability' && o.abilityId === ARCANE_VASSAL),
    ).toBe(false);
    // Out of range: nothing to pick.
    const far = editable(s);
    placeUnit(scenario, far, STARSEER, 5, 40);
    expect(
      engine
        .unitOptions(far, KROAK)
        .some((o) => o.t === 'ability' && o.abilityId === ARCANE_VASSAL),
    ).toBe(false);
  });

  it('measures the next Spell from the target, and is spent by it', () => {
    const s = arena([KROAK, STARSEER, DRYADS], at);
    expect(celestial(s)).toBeUndefined(); // the Dryads are 29" from Kroak
    const used = engine.apply(s, vassal()).state;
    expect(celestial(used)).toMatchObject({ targets: [DRYADS] });
    const cast = applyUntil(
      engine,
      used,
      { t: 'ability', unit: KROAK, abilityId: CELESTIAL_DELIVERANCE, target: DRYADS },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    expect(events(cast.events, 'cast')[0]).toMatchObject({ unit: KROAK });
    expect(cast.state.effects?.some((e) => e.id === ARCANE_VASSAL)).toBe(false);
    // The next Spell is measured from Kroak again.
    expect(celestial(cast.state)).toBeUndefined();
  });

  it('treats the target as the caster for Unbind', () => {
    const s = arena([KROAK, STARSEER, ALARIELLE, SAURUS_WARRIORS], {
      [KROAK]: [64, 22],
      [STARSEER]: [50, 22],
      [ALARIELLE]: [25, 22],
      [SAURUS_WARRIORS]: [40, 22],
    });
    const used = engine.apply(s, vassal()).state;
    const o = spellOf(used, KROAK);
    const cast = applyUntil(
      engine,
      used,
      {
        t: 'ability',
        unit: KROAK,
        abilityId: o.abilityId,
        ...(o.targets[0] ? { target: o.targets[0] } : {}),
      },
      (r) => r.events.some((e) => e.t === 'cast' && e.success),
    );
    const d = engine.decision(cast.state);
    expect(d?.kind).toBe('reaction');
    if (d?.kind === 'reaction') {
      expect(d.options.map((x) => ('unit' in x ? x.unit : ''))).toContain(ALARIELLE);
      expect(d.trigger).toContain(STARSEER);
    }
  });
});

describe('Dead for Innumerable Ages (c5a7-920c-9ff8-652)', () => {
  function endOfTurn(damage: number, active: 0 | 1): GameState {
    const s = arena([KROAK, DRYADS], { [KROAK]: [30, 22], [DRYADS]: [4, 4] }, active);
    s.phase = 'end';
    s.units[KROAK]!.damage = damage;
    return s;
  }
  const total = (list: GameEvent[]): number | null => {
    const n = events(list, 'note').find((e) => e.text.startsWith('Dead for Innumerable Ages'));
    const m = n?.text.match(/rolls (\d+)/);
    return m ? Number(m[1]) : null;
  };

  it('rolls 3D6 plus damage points at the end of any turn: 20+ destroys, otherwise heals 18', () => {
    for (const active of [0, 1] as const) {
      const seen = { destroyed: 0, healed: 0 };
      for (let rng = 1; rng <= 120; rng++) {
        const r = engine.apply({ ...endOfTurn(8, active), rng }, { t: 'pass' });
        const t = total(r.events);
        expect(t, `rng ${rng}`).not.toBeNull();
        const kroak = r.state.units[KROAK]!;
        if (t! >= 20) {
          expect(kroak.status).toBe('destroyed');
          seen.destroyed++;
        } else {
          expect(kroak.status).toBe('battlefield');
          expect(kroak.damage).toBe(0);
          seen.healed++;
        }
      }
      expect(seen.destroyed).toBeGreaterThan(0);
      expect(seen.healed).toBeGreaterThan(0);
    }
  });

  it('adds the damage points to the roll', () => {
    const a = engine.apply({ ...endOfTurn(2, 1), rng: 7 }, { t: 'pass' });
    const b = engine.apply({ ...endOfTurn(5, 1), rng: 7 }, { t: 'pass' });
    expect(total(b.events)! - total(a.events)!).toBe(3);
  });

  it('does nothing for an undamaged Kroak', () => {
    const r = engine.apply(endOfTurn(0, 1), { t: 'pass' });
    expect(total(r.events)).toBeNull();
    expect(r.state.units[KROAK]!.status).toBe('battlefield');
  });
});

describe('Vengeance of Azyr (7c7e-3757-9881-5bd7)', () => {
  const at: At = {
    [SAURUS_WARRIORS]: [20, 22],
    [KROXIGOR]: [20, 30],
    [DRYADS]: [23, 22],
    [ALARIELLE]: [24, 30],
  };
  function endOfTurn(active: 0 | 1 = 1): GameState {
    const s = arena([SAURUS_WARRIORS, KROXIGOR, DRYADS, ALARIELLE], at, active);
    s.phase = 'end';
    return s;
  }
  const pass: Action = { t: 'pass' };

  it('is asked of the Seraphon player at the end of either turn while Saurus or Kroxigor are in combat', () => {
    for (const active of [1, 0] as const) {
      const d = engine.decision(engine.apply(endOfTurn(active), pass).state);
      expect(d).toMatchObject({ kind: 'vengeance', player: 1, stage: 'pick', max: 3 });
      if (d?.kind === 'vengeance') expect([...d.units].sort()).toEqual([KROXIGOR, SAURUS_WARRIORS]);
    }
  });

  it('is not asked when nothing is in combat', () => {
    const s = endOfTurn();
    placeUnit(scenario, s, DRYADS, 4, 4);
    placeUnit(scenario, s, ALARIELLE, 4, 40);
    const r = engine.apply(s, pass).state;
    expect(engine.decision(r)?.kind).not.toBe('vengeance');
    expect(r.active).toBe(0);
  });

  it('declining (none) ends the turn; a pass is not an answer', () => {
    const s = engine.apply(endOfTurn(), pass).state;
    expect(() => engine.apply(s, pass)).toThrow();
    const r = engine.apply(s, { t: 'choose', value: 'none' }).state;
    expect(engine.decision(r)?.kind).not.toBe('vengeance');
    expect(r.active).toBe(0);
  });

  it('piles the picked unit in, then D3 mortal damage on 2+ to the one enemy in combat with it', () => {
    let hit = 0;
    let miss = 0;
    for (let rng = 1; rng <= 60; rng++) {
      let s = engine.apply({ ...endOfTurn(), rng }, pass).state;
      s = engine.apply(s, { t: 'choose', value: `vengeance:${SAURUS_WARRIORS}` }).state;
      expect(engine.decision(s)).toMatchObject({
        kind: 'place',
        reason: 'pileIn',
        unit: SAURUS_WARRIORS,
        player: 1,
      });
      const r = engine.apply(s, pass); // the pile-in is left as it is
      const roll = events(r.events, 'roll').find((e) => e.label === 'Vengeance of Azyr');
      expect(roll).toBeDefined();
      const dmg = events(r.events, 'damage').find((e) => e.source === 'Vengeance of Azyr');
      if (roll!.dice[0]! >= 2) {
        hit++;
        expect(dmg).toMatchObject({ unit: DRYADS });
      } else {
        miss++;
        expect(dmg).toBeUndefined();
      }
      expect(r.state.active).toBe(0); // the turn then ended
    }
    expect(hit).toBeGreaterThan(0);
    expect(miss).toBeGreaterThan(0);
  });

  it('with several enemies in combat the player picks which to strike; only the right units may be picked', () => {
    const s = endOfTurn();
    placeUnit(scenario, s, ALARIELLE, 20, 27); // also within 3" of the Warriors
    let st = engine.apply(s, pass).state;
    expect(() => engine.apply(st, { t: 'choose', value: `vengeance:${DRYADS}` })).toThrow(); // not a Seraphon
    expect(() =>
      engine.apply(st, {
        t: 'choose',
        value: `vengeance:${SAURUS_WARRIORS},${KROXIGOR},${KROAK},${STARSEER}`,
      }),
    ).toThrow(); // more than three, and not in combat
    st = engine.apply(st, { t: 'choose', value: `vengeance:${SAURUS_WARRIORS}` }).state;
    st = engine.apply(st, pass).state; // the pile-in
    const d = engine.decision(st);
    expect(d).toMatchObject({ kind: 'vengeance', stage: 'enemy', unit: SAURUS_WARRIORS });
    if (d?.kind === 'vengeance') expect([...d.units].sort()).toEqual([ALARIELLE, DRYADS]);
    expect(() => engine.apply(st, { t: 'choose', value: KROXIGOR })).toThrow();
    const r = engine.apply(st, { t: 'choose', value: ALARIELLE });
    expect(events(r.events, 'roll').some((e) => e.label === 'Vengeance of Azyr')).toBe(true);
  });

  it('the NPC picks the units and the enemy, and the default declines', () => {
    const s = engine.apply(endOfTurn(), pass).state;
    expect(engine.defaultAction(s)).toEqual({ t: 'choose', value: 'none' });
    const pick = chooseAction(engine, s);
    expect(pick).toMatchObject({ t: 'choose' });
    let st = engine.apply(s, pick).state;
    st = engine.apply(st, chooseAction(engine, st)).state; // the pile-in
    for (let i = 0; i < 6 && engine.decision(st)?.kind === 'vengeance'; i++) {
      st = engine.apply(st, chooseAction(engine, st)).state;
    }
    expect(engine.decision(st)?.kind).not.toBe('vengeance');
  });
});
