/**
 * Place of Power: Dizzying Rage gives a unit the ability to unbind or banish, and nothing else.
 * It never lets a non-Wizard cast a spell, summon or chant (owner's ruling, 2026-11-18; I89).
 * The Seraphon list has no prayer lore, so the prayer path cannot be pinned with this list; the
 * chant option is gated on a Priest power level in the same way as casting.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  type GameState,
  type UnitId,
} from '../index.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from '../test-helpers.js';
import { eligibleUnbinders, manifestationUnitId } from './magic.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const ALARIELLE = '0:0';
const SAURUS_WARRIORS = '1:5'; // no Wizard, no Priest
const CELESTIAL_DELIVERANCE = 'f7bf-5a9-2828-a74'; // a Seraphon lore spell
const SUMMON_PENDULUM = '678b-96e1-66bb-1de8';
const WS_PENDULUM = 'fcb6-ae80-2e58-aadb';

/** Seraphon's turn: the Saurus Warriors hold Dizzying Rage; Alarielle's Pendulum is in play. */
function raging(withManifestation: boolean, active: 0 | 1 = 1): GameState {
  const s0 = editable(startGame(engine, 1));
  const ids: UnitId[] = [ALARIELLE, SAURUS_WARRIORS];
  keepOnly(s0, ids);
  placeUnit(scenario, s0, ALARIELLE, 12, 22);
  placeUnit(scenario, s0, SAURUS_WARRIORS, 30, 22);
  s0.active = 0;
  s0.turnIndex = 0;
  s0.phase = 'hero';
  s0.stack = [];
  for (const p of s0.players) {
    p.cp = 4;
    p.rageDice = 0;
  }
  let s = s0;
  if (withManifestation) {
    s = applyUntil(engine, s0, { t: 'ability', unit: ALARIELLE, abilityId: SUMMON_PENDULUM }, (r) =>
      r.events.some((e) => e.t === 'cast' && e.success),
    ).state;
    for (let i = 0; i < 12; i++) {
      const d = engine.decision(s);
      if (!d || d.kind === 'main') break;
      s = engine.apply(s, engine.defaultAction(s)).state;
    }
    s = editable(s);
    placeUnit(scenario, s, manifestationUnitId(0, WS_PENDULUM), 40, 22);
  } else {
    s = editable(s);
  }
  s.active = active;
  s.phase = 'hero';
  s.stack = [];
  s.units[SAURUS_WARRIORS]!.castsUsed = 0;
  s.effects = [
    ...(s.effects ?? []),
    {
      id: 'place-of-power',
      name: 'Place of Power (Dizzying Rage)',
      sourceUnit: SAURUS_WARRIORS,
      targetUnit: SAURUS_WARRIORS,
      owner: 1,
      expires: 'turn',
      data: { boon: 'dizzying_rage' },
    },
  ];
  return s;
}

describe('Dizzying Rage (Place of Power)', () => {
  it('offers a non-Wizard Banish but no spell, summon or prayer', () => {
    const s = raging(true);
    const opts = engine.unitOptions(s, SAURUS_WARRIORS).filter((o) => o.t === 'ability');
    expect(opts.map((o) => (o.t === 'ability' ? o.kind : ''))).toEqual(['banish']);
  });

  it('refuses a Seraphon lore spell from the raging unit', () => {
    const s = raging(true);
    expect(() =>
      engine.apply(s, {
        t: 'ability',
        unit: SAURUS_WARRIORS,
        abilityId: CELESTIAL_DELIVERANCE,
        target: SAURUS_WARRIORS,
      }),
    ).toThrow(IllegalActionError);
  });

  it('offers a non-Wizard no magic at all when there is nothing to banish', () => {
    const s = raging(false);
    expect(engine.unitOptions(s, SAURUS_WARRIORS).filter((o) => o.t === 'ability')).toEqual([]);
  });

  const boonLeft = (s: GameState) =>
    (s.effects ?? []).some((e) => e.id === 'place-of-power' && e.targetUnit === SAURUS_WARRIORS);

  it('makes the unit an enemy spell unbinder', () => {
    const s = raging(false, 0);
    expect(eligibleUnbinders(scenario, s, s.units[ALARIELLE]!).map((u) => u.id)).toEqual([
      SAURUS_WARRIORS,
    ]);
  });

  it('spends the boon on a banish, and a second use is refused', () => {
    const s = raging(true);
    expect(boonLeft(s)).toBe(true);
    const id = manifestationUnitId(0, WS_PENDULUM);
    const r = engine.apply(s, {
      t: 'ability',
      unit: SAURUS_WARRIORS,
      abilityId: 'banish',
      target: id,
    });
    expect(boonLeft(r.state)).toBe(false);
    expect(r.events.some((e) => e.t === 'banish')).toBe(true);
    expect(
      engine.unitOptions(editable(r.state), SAURUS_WARRIORS).filter((o) => o.t === 'ability'),
    ).toEqual([]);
    expect(() =>
      engine.apply(r.state, {
        t: 'ability',
        unit: SAURUS_WARRIORS,
        abilityId: 'banish',
        target: id,
      }),
    ).toThrow(IllegalActionError);
  });

  it('spends the boon on an unbind, and a second unbind is refused', () => {
    const s = raging(false, 0);
    expect(boonLeft(s)).toBe(true);
    const cast = applyUntil(
      engine,
      s,
      { t: 'ability', unit: ALARIELLE, abilityId: SUMMON_PENDULUM },
      (x) => x.events.some((e) => e.t === 'cast' && e.success),
    );
    const st = cast.state;
    expect(engine.decision(st)).toMatchObject({
      options: [{ ability: 'unbind', unit: SAURUS_WARRIORS }],
    });
    const r = engine.apply(st, { t: 'ability', unit: SAURUS_WARRIORS, abilityId: 'unbind' });
    expect(r.events.some((e) => e.t === 'unbind' && e.unit === SAURUS_WARRIORS)).toBe(true);
    expect(boonLeft(r.state)).toBe(false);
    expect(eligibleUnbinders(scenario, r.state, r.state.units[ALARIELLE]!)).toEqual([]);
  });

  it('the NPC banishes through it, and never casts', () => {
    let s = raging(true);
    const a = chooseAction(engine, s);
    expect(chooseAction(engine, s)).toEqual(a);
    expect(a).toMatchObject({
      t: 'ability',
      unit: SAURUS_WARRIORS,
      abilityId: 'banish',
      target: manifestationUnitId(0, WS_PENDULUM),
    });
    const casts: string[] = [];
    for (let i = 0; i < 20 && s.phase === 'hero' && s.active === 1; i++) {
      const r = engine.apply(s, chooseAction(engine, s));
      for (const e of r.events) if (e.t === 'cast') casts.push(e.unit);
      s = r.state;
    }
    expect(casts).not.toContain(SAURUS_WARRIORS);
  });
});
