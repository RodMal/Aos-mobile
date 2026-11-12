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
import { editable, keepOnly, passTo, placeUnit, startGame } from './test-helpers.js';
import { WYLDWOOD_OUTLINES } from '../data/wyldwood.js';
import {
  baseFootprint,
  convexPolygonsOverlap,
  footprintGap,
  footprintGapAtLeast,
  footprintPolygon,
  footprintsOverlap,
  pointInPolygon,
  type Footprint,
  type ReadonlyPoint,
} from '../geom/index.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const REALMSHAPER = '1:terrain';

function named(s: GameState, name: string) {
  return Object.values(s.units).find((u) => u.name === name)!;
}

/** Dryads 1.5" from the enemy Realmshaper Engine, the Sylvaneth Wyldwood far away. */
function nearEngine(): GameState {
  const s = editable(startGame(engine, 1));
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
  it('uses the owner\'s footprints: the traced Wyldwood crescent and a 6" square engine', () => {
    const units = startGame(engine, 1).units;
    expect(profileOf(scenario, units[WYLDWOOD]!).models).toEqual([
      { base: { kind: 'outline', points: WYLDWOOD_OUTLINES[0] }, champion: false },
    ]);
    expect(profileOf(scenario, units[REALMSHAPER]!).models).toEqual([
      { base: { kind: 'rect', lengthMm: 152.4, widthMm: 152.4 }, champion: false },
    ]);
  });

  it('treats the crescent as concave: a base in its hollow is close but does not overlap', () => {
    const fp = baseFootprint({ kind: 'outline', points: WYLDWOOD_OUTLINES[0]! }, 30, 20, 37);
    const pts = fp.kind === 'polygon' ? fp.outline : [];
    // The midpoint between the two tips lies in the hollow; walk towards the trunk.
    let tips: [ReadonlyPoint, ReadonlyPoint] = [pts[0]!, pts[0]!];
    for (const p of pts) {
      for (const q of pts) {
        if (
          Math.hypot(p[0] - q[0], p[1] - q[1]) >
          Math.hypot(tips[0][0] - tips[1][0], tips[0][1] - tips[1][1])
        ) {
          tips = [p, q];
        }
      }
    }
    let x = (tips[0][0] + tips[1][0]) / 2;
    let y = (tips[0][1] + tips[1][1]) / 2;
    const base = (): Footprint => baseFootprint({ kind: 'round', diameterMm: 25 }, x, y);
    const dx = 30 - x;
    const dy = 20 - y;
    const len = Math.hypot(dx, dy);
    while (footprintGap(fp, base()) > 0.3) {
      x += (dx / len) * 0.02;
      y += (dy / len) * 0.02;
    }
    expect(pointInPolygon([x, y], pts)).toBe(false);
    expect(footprintsOverlap(fp, base())).toBe(false);
    expect(footprintGap(fp, base())).toBeGreaterThan(0);
    expect(footprintGapAtLeast(fp, base(), 3)).toBe(false);
    // A convex test (the crescent's own outline treated as convex) would wrongly overlap.
    expect(convexPolygonsOverlap(pts, footprintPolygon(base()))).toBe(true);
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
