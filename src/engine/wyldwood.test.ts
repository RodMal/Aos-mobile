import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { chooseAction } from '../ai/baseline.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  overgrownTokenIds,
  unitFootprints,
  type GameState,
} from './index.js';
import { editable, keepOnly, passTo, startGame } from './test-helpers.js';
import { baseFootprint, footprintDistanceToPolygon, footprintGapAtLeast } from '../geom/index.js';
import { footprintToPoint } from '../rules/core/objectives.js';
import { WYLDWOOD_SETUP_ID } from './wyldwood.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const setUp = { t: 'ability', unit: WYLDWOOD, abilityId: WYLDWOOD_SETUP_ID } as const;

const hasOption = (s: GameState) =>
  engine
    .unitOptions(s, WYLDWOOD)
    .some((o) => o.t === 'ability' && o.abilityId === WYLDWOOD_SETUP_ID);

const wyldwoods = (s: GameState) =>
  Object.values(s.units).filter(
    (u) => u.owner === 0 && u.status === 'battlefield' && u.name === 'Awakened Wyldwood',
  );

/** Sets up one more piece at the suggested spot. */
function setUpOne(s: GameState): GameState {
  const declared = engine.apply(s, setUp).state;
  const d = engine.decision(declared)!;
  if (d.kind !== 'place' || d.reason !== 'setUp') throw new Error('expected a set-up placement');
  const piece = declared.units[d.unit]!;
  const placement = {
    unit: piece.id,
    models: piece.models.map((m, i) => ({ i, x: m.x, y: m.y, rot: m.rot })),
  };
  return engine.apply(declared, { t: 'place', placement }).state;
}

describe('further Awakened Wyldwood pieces (owner, 2026-11-11)', () => {
  it('is offered in the Sylvaneth player’s own hero phase, once per turn', () => {
    const s = startGame(engine, 1);
    expect(s.active).toBe(0);
    expect(wyldwoods(s)).toHaveLength(1);
    expect(hasOption(s)).toBe(true);
    const after = setUpOne(s);
    expect(wyldwoods(after)).toHaveLength(2);
    // The new piece is its own faction terrain with the second outline.
    const piece = wyldwoods(after).find((u) => u.id !== WYLDWOOD)!;
    expect(piece.profileId).toMatch(/:piece2$/);
    expect(hasOption(after)).toBe(false);
    expect(() => engine.apply(after, setUp)).toThrow(IllegalActionError);
    // Not in other phases.
    expect(hasOption(passTo(engine, editable(s), 'movement'))).toBe(false);
  });

  it('stops at three pieces on the battlefield', () => {
    let s = setUpOne(startGame(engine, 1));
    s = editable(s);
    delete s.players[0].wyldwoodSetUpTurn; // as if a later turn
    s = setUpOne(s);
    expect(wyldwoods(s)).toHaveLength(3);
    expect(wyldwoods(s).map((u) => u.profileId.replace(/.*:/, ''))).toContain('piece3');
    s = editable(s);
    delete s.players[0].wyldwoodSetUpTurn;
    expect(hasOption(s)).toBe(false);
  });

  it('rejects a spot off the table or on a unit', () => {
    const declared = engine.apply(startGame(engine, 1), setUp).state;
    const d = engine.decision(declared)!;
    if (d.kind !== 'place') throw new Error('expected placement');
    const at = (x: number, y: number) =>
      engine
        .checkPlacement(declared, { unit: d.unit, models: [{ i: 0, x, y, rot: 0 }] })
        .map((v) => v.message);
    const unit = declared.units['0:6']!.models[0]!;
    expect(at(unit.x, unit.y).length).toBeGreaterThan(0);
    expect(at(-5, 10).join(' ')).toMatch(/wholly on the battlefield/);
  });

  describe('Reclaimed By Nature limits, edge to edge (owner, 2026-11-12)', () => {
    // A board with only the piece being placed (others added per test).
    const declared = editable(engine.apply(startGame(engine, 1), setUp).state);
    const d = engine.decision(declared)!;
    if (d.kind !== 'place') throw new Error('expected placement');
    const piece = declared.units[d.unit]!;
    keepOnly(declared, [piece.id]);
    const base = scenario.profiles[piece.profileId]!.models[0]!.base;
    const fpAt = (x: number, y: number) => baseFootprint(base, x, y, 0);
    const messages = (s: GameState, x: number, y: number) =>
      engine
        .checkPlacement(s, { unit: piece.id, models: [{ i: 0, x, y, rot: 0 }] })
        .map((v) => v.message);
    const { objectives, terrain, width, height } = scenario.battlefield;
    const objEdge = (x: number, y: number) =>
      Math.min(...objectives.map((o) => footprintToPoint(fpAt(x, y), o.x, o.y) - 0.787));
    const terrainGap = (x: number, y: number) =>
      Math.min(...terrain.map((t) => footprintDistanceToPolygon(fpAt(x, y), t.polygon)));
    /** The first spot on a 0.25" grid, well on the table, where `ok` holds. */
    const find = (ok: (x: number, y: number) => boolean, step = 0.25) => {
      for (let x = 6; x <= width - 6; x += step)
        for (let y = 6; y <= height - 6; y += step) if (ok(x, y)) return { x, y };
      throw new Error('no spot');
    };

    it('terrain features: 1", not 3"', () => {
      const ok = find(
        (x, y) => objEdge(x, y) > 3.5 && terrainGap(x, y) > 1.5 && terrainGap(x, y) < 2.5,
      );
      expect(messages(declared, ok.x, ok.y)).toEqual([]);
      const bad = find(
        (x, y) => objEdge(x, y) > 3.5 && terrainGap(x, y) > 0.2 && terrainGap(x, y) < 0.8,
      );
      expect(messages(declared, bad.x, bad.y)).toEqual([
        'Set it up more than 1" from every other terrain feature.',
      ]);
    });

    it('objectives: 3" from the marker’s edge', () => {
      const bad = find(
        (x, y) => terrainGap(x, y) > 2 && objEdge(x, y) > 2.4 && objEdge(x, y) < 2.9,
      );
      // More than 3" from the objective's centre but not from the marker's edge.
      expect(objEdge(bad.x, bad.y) + 0.787).toBeGreaterThan(3);
      expect(messages(declared, bad.x, bad.y).join(' ')).toMatch(
        /more than 3" from every objective/,
      );
      const ok = find((x, y) => terrainGap(x, y) > 2 && objEdge(x, y) > 3.1 && objEdge(x, y) < 3.4);
      expect(messages(declared, ok.x, ok.y)).toEqual([]);
    });

    it('enemy units 3"; friendly units only may not overlap', () => {
      const spot = find((x, y) => terrainGap(x, y) > 6 && objEdge(x, y) > 6);
      const s = editable(declared);
      const fp = fpAt(spot.x, spot.y);
      // One model of each side 2" from the piece's outline (above and below it).
      const friend = s.units['0:6']!;
      const enemy = s.units['1:1']!;
      for (const [u, dir] of [
        [friend, 1],
        [enemy, -1],
      ] as const) {
        u.status = 'battlefield';
        u.models.forEach((m, i) => (m.alive = i === 0));
        const m = u.models[0]!;
        let r = 0;
        do {
          r += 0.05;
          Object.assign(m, { x: spot.x, y: spot.y + dir * r });
        } while (!footprintGapAtLeast(fp, unitFootprints(scenario, u)[0]!, 2));
      }
      expect(messages(s, spot.x, spot.y)).toEqual([
        `Set it up more than 3" from every enemy unit (${enemy.name}).`,
      ]);
      enemy.status = 'destroyed';
      expect(messages(s, spot.x, spot.y)).toEqual([]);
    });

    it('other friendly Awakened Wyldwoods: 12"', () => {
      const s = editable(declared);
      const wood = s.units[WYLDWOOD]!;
      wood.status = 'battlefield';
      Object.assign(wood.models[0]!, { x: 8, y: 8, rot: 0, alive: true });
      const woodFp = unitFootprints(scenario, wood)[0]!;
      const clear = (x: number, y: number) => terrainGap(x, y) > 1.5 && objEdge(x, y) > 3.5;
      const bad = find(
        (x, y) =>
          clear(x, y) &&
          footprintGapAtLeast(fpAt(x, y), woodFp, 8) &&
          !footprintGapAtLeast(fpAt(x, y), woodFp, 10),
        0.5,
      );
      expect(messages(s, bad.x, bad.y)).toEqual([
        'Set it up more than 12" from every other friendly Awakened Wyldwood.',
      ]);
      const ok = find((x, y) => footprintGapAtLeast(fpAt(x, y), woodFp, 12.2) && clear(x, y), 0.5);
      expect(messages(s, ok.x, ok.y)).toEqual([]);
    });
  });

  it('pass cancels the set-up and the option comes back', () => {
    const s = startGame(engine, 1);
    const declared = engine.apply(s, setUp).state;
    const d = engine.decision(declared)!;
    if (d.kind !== 'place') throw new Error('expected placement');
    const back = engine.apply(declared, { t: 'pass' }).state;
    expect(back.units[d.unit]).toBeUndefined();
    expect(wyldwoods(back)).toHaveLength(1);
    expect(hasOption(back)).toBe(true);
  });

  it('carries its owner’s overgrown token and survives a JSON round trip', () => {
    const s = startGame(engine, 1);
    const before = overgrownTokenIds(scenario, s, 0).length;
    const after = setUpOne(s);
    expect(overgrownTokenIds(scenario, after, 0).length).toBe(before + 1);
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  });

  it('the NPC sets one up and places it legally', () => {
    let s = startGame(engine, 1);
    const a = chooseAction(engine, s);
    expect(a).toEqual(setUp);
    s = engine.apply(s, a).state;
    s = engine.apply(s, chooseAction(engine, s)).state;
    expect(wyldwoods(s)).toHaveLength(2);
    expect(engine.decision(s)).toMatchObject({ kind: 'main', phase: 'hero' });
  });
});
