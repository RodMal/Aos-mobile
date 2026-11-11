import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  inCombat,
  profileOf,
  unitDistance,
  type GameState,
} from './index.js';
import { editable, keepOnly, passTo, placeUnit } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const REALMSHAPER = '1:terrain';

function named(s: GameState, name: string) {
  return Object.values(s.units).find((u) => u.name === name)!;
}

/** Dryads 1.5" from the enemy Realmshaper Engine, the Sylvaneth Wyldwood far away. */
function nearEngine(): GameState {
  const s = editable(engine.newGame(1));
  const dryads = named(s, 'Dryads');
  keepOnly(s, [dryads.id, WYLDWOOD, REALMSHAPER, '1:1']);
  placeUnit(scenario, s, dryads.id, 24, 22);
  placeUnit(scenario, s, REALMSHAPER, 34, 22);
  const gap = unitDistance(scenario, dryads, s.units[REALMSHAPER]!);
  for (const m of s.units[REALMSHAPER]!.models) m.x -= gap - 1.5;
  placeUnit(scenario, s, WYLDWOOD, 4, 4);
  placeUnit(scenario, s, '1:1', 55, 40);
  return s;
}

describe('faction terrain (owner ruling, 2026-11-11)', () => {
  it('is set up with the 6" x 4" footprint from the data, not a 32mm base', () => {
    for (const id of [WYLDWOOD, REALMSHAPER]) {
      const p = profileOf(scenario, engine.newGame(1).units[id]!);
      expect(p.models).toEqual([
        { base: { kind: 'rect', lengthMm: 152.4, widthMm: 101.6 }, champion: false },
      ]);
    }
  });

  it('never acts: no options, and actions naming it are rejected', () => {
    let s = nearEngine();
    for (const phase of ['hero', 'movement', 'shooting', 'charge', 'combat', 'end'] as const) {
      s = passTo(engine, s, phase);
      expect(engine.unitOptions(s, WYLDWOOD)).toEqual([]);
    }
    const move = passTo(engine, nearEngine(), 'movement');
    expect(() => engine.apply(move, { t: 'move', unit: WYLDWOOD, kind: 'normal' })).toThrow(
      IllegalActionError,
    );
    const charge = passTo(engine, nearEngine(), 'charge');
    expect(() => engine.apply(charge, { t: 'charge', unit: WYLDWOOD })).toThrow(/faction terrain/);
  });

  it('puts no unit in combat: normal moves and runs, and no charge at it', () => {
    const s = nearEngine();
    const dryads = named(s, 'Dryads');
    expect(inCombat(scenario, s, dryads)).toBe(false);
    const move = passTo(engine, s, 'movement');
    expect(engine.unitOptions(move, dryads.id).map((o) => o.t === 'move' && o.kind)).toEqual([
      'normal',
      'run',
      false,
    ]);
    // A normal move that stays 1.5" from the engine is legal: no combat range.
    const step = engine.apply(move, { t: 'move', unit: dryads.id, kind: 'normal' }).state;
    const placement = {
      unit: dryads.id,
      models: dryads.models.map((m, i) => ({ i, x: m.x, y: m.y + 2, rot: m.rot })),
    };
    expect(engine.checkPlacement(step, placement).map((v) => v.code)).toEqual([]);
    // Only the terrain is within 12": nothing to charge.
    const charge = passTo(engine, s, 'charge');
    expect(engine.unitOptions(charge, dryads.id)).toEqual([]);
  });

  it('may be attacked in the combat phase by units within 3", but need not be', () => {
    const combat = passTo(engine, nearEngine(), 'combat');
    const dryads = named(combat, 'Dryads');
    const d = engine.decision(combat);
    expect(d).toMatchObject({ kind: 'fightPick', player: 0, canPass: true });
    // Passing declines; the phase can then end.
    const passed = engine.apply(combat, { t: 'pass' }).state;
    expect(engine.decision(passed)).toMatchObject({ kind: 'main', phase: 'combat' });
    // Fighting offers the terrain as a melee target.
    let f = engine.apply(combat, { t: 'fight', unit: dryads.id }).state;
    f = engine.apply(f, { t: 'pass' }).state; // no pile-in
    const targets = engine.targetOptions(f, dryads.id, 'fight');
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((w) => w.targets.some((t) => t.unit === REALMSHAPER))).toBe(true);
  });
});
