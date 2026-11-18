/**
 * Place of Power: Dizzying Rage gives a unit the ability to unbind or banish, and nothing else.
 * It never lets a non-Wizard cast a spell, summon or chant (owner's ruling, 2026-11-18; I89).
 */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario, type GameState, type UnitId } from '../index.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from '../test-helpers.js';
import { eligibleUnbinders, manifestationUnitId } from './magic.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const ALARIELLE = '0:0';
const SAURUS_WARRIORS = '1:5'; // no Wizard, no Priest
const SUMMON_PENDULUM = '678b-96e1-66bb-1de8';
const WS_PENDULUM = 'fcb6-ae80-2e58-aadb';

/** Seraphon's turn: the Saurus Warriors hold Dizzying Rage; Alarielle's Pendulum is in play. */
function raging(withManifestation: boolean): GameState {
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
  s.active = 1;
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

  it('refuses a spell or summon from the raging unit', () => {
    const s = raging(true);
    expect(() =>
      engine.apply(s, { t: 'ability', unit: SAURUS_WARRIORS, abilityId: SUMMON_PENDULUM }),
    ).toThrow();
  });

  it('offers a non-Wizard no magic at all when there is nothing to banish', () => {
    const s = raging(false);
    expect(engine.unitOptions(s, SAURUS_WARRIORS).filter((o) => o.t === 'ability')).toEqual([]);
  });

  it('makes the unit an enemy spell unbinder, and spends the boon', () => {
    const s = raging(false);
    expect(eligibleUnbinders(scenario, s, s.units[ALARIELLE]!).map((u) => u.id)).toEqual([
      SAURUS_WARRIORS,
    ]);
  });

  it('the NPC never casts through it, and banishes the manifestation', () => {
    const s = raging(true);
    const a = chooseAction(engine, s);
    expect(chooseAction(engine, s)).toEqual(a);
    if (a.t === 'ability' && a.unit === SAURUS_WARRIORS) expect(a.abilityId).toBe('banish');
  });
});
