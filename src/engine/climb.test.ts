/** Core 15.2: climbing terrain taller than 1" counts its height up and down, unless FLY. */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { climbHeight } from '../data/battlefield.js';
import { footprintDistanceToPolygon } from '../geom/index.js';
import { createEngine, createScenario, formPlacement, modelFootprint, profileOf } from './index.js';
import { checkMovePlacement } from './movement.js';
import { hasEffectiveKeyword } from './abilities/effects.js';
import { editable, keepOnly, placeUnit, startGame } from './test-helpers.js';
import type { GameState, Placement, UnitId } from './types.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const spire = scenario.battlefield.terrain.find((t) => t.id === 'spire-e')!; // (53, 17), 5" square
const ruin = scenario.battlefield.terrain.find((t) => t.kind === 'ruin')!;

function pick(): { walker: UnitId; flyer: UnitId } {
  const s = startGame(engine, 1);
  const own = s.unitOrder.filter(
    (id) => s.units[id]!.owner === 0 && !profileOf(scenario, s.units[id]!).isFactionTerrain,
  );
  const flies = (id: UnitId) => hasEffectiveKeyword(scenario, s, s.units[id]!, 'FLY');
  const single = (id: UnitId) => s.units[id]!.models.length === 1;
  const walker = own.find((id) => !flies(id) && single(id));
  const flyer = own.find((id) => flies(id) && single(id));
  if (!walker || !flyer) throw new Error('need a lone walker and a lone flyer');
  return { walker, flyer };
}

/** The unit starts 3" west of the spire and moves to 3" east of it, in a straight line over it. */
function crossing(id: UnitId): { s: GameState; p: Placement; flat: number } {
  const s = editable(startGame(engine, 1));
  const enemy = s.unitOrder.find((u) => s.units[u]!.owner === 1)!;
  keepOnly(s, [id, enemy]);
  placeUnit(scenario, s, enemy, 10, 40, 0);
  const xs = spire.polygon.map((q) => q[0]);
  const x0 = Math.min(...xs) - 3;
  const x1 = Math.max(...xs) + 3;
  placeUnit(scenario, s, id, x0, 17, 0);
  const p = formPlacement(scenario, s.units[id]!, { x: x1, y: 17 }, 0);
  return { s, p, flat: x1 - x0 };
}

const codes = (c: { s: GameState; p: Placement }, id: UnitId, allowance: number): string[] =>
  checkMovePlacement(scenario, c.s, c.s.units[id]!, c.p, { reason: 'normal', allowance }).map(
    (v) => v.code,
  );

describe('climbing terrain (Core 15.2)', () => {
  it('only terrain over 1" tall counts as a climb: spires yes, ruins and outcrops no', () => {
    expect(climbHeight(spire)).toBeGreaterThan(1);
    for (const t of scenario.battlefield.terrain.filter((f) => f.kind !== 'spire')) {
      expect(climbHeight(t)).toBe(0);
    }
  });

  it('a walker crossing a spire pays the climb up and down', () => {
    const { walker } = pick();
    const c = crossing(walker);
    const climb = 2 * climbHeight(spire);
    expect(codes(c, walker, c.flat + 0.01)).toContain('TOO_FAR');
    expect(codes(c, walker, c.flat + climb - 0.01)).toContain('TOO_FAR');
    expect(codes(c, walker, c.flat + climb + 0.01)).not.toContain('TOO_FAR');
  });

  it('a flyer crossing a spire pays nothing', () => {
    const { flyer } = pick();
    const c = crossing(flyer);
    expect(codes(c, flyer, c.flat + 0.01)).not.toContain('TOO_FAR');
  });

  it('a walker crossing a ruin pays nothing', () => {
    const { walker } = pick();
    const s = editable(startGame(engine, 1));
    const enemy = s.unitOrder.find((u) => s.units[u]!.owner === 1)!;
    keepOnly(s, [walker, enemy]);
    placeUnit(scenario, s, enemy, 10, 40, 0);
    const cx = ruin.polygon.reduce((a, q) => a + q[0], 0) / ruin.polygon.length;
    const cy = ruin.polygon.reduce((a, q) => a + q[1], 0) / ruin.polygon.length;
    placeUnit(scenario, s, walker, cx - 4, cy, 0);
    const p = formPlacement(scenario, s.units[walker]!, { x: cx + 4, y: cy }, 0);
    const v = checkMovePlacement(scenario, s, s.units[walker]!, p, {
      reason: 'normal',
      allowance: 8.01,
    });
    expect(v.map((x) => x.code)).not.toContain('TOO_FAR');
  });

  describe('next to a spire without crossing it', () => {
    const BASTILADON = '1:7'; // oval base
    const xMin = Math.min(...spire.polygon.map((q) => q[0]));

    /** Centre x, west of the spire at y = 17, where the base is `gap` inches clear of it. */
    function xAtGap(s: GameState, id: UnitId, gap: number): number {
      let lo = xMin - 10;
      let hi = xMin;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        const fp = modelFootprint(scenario, s.units[id]!, 0, { x: mid, y: 17, rot: 0 });
        if (footprintDistanceToPolygon(fp, spire.polygon) > gap) lo = mid;
        else hi = mid;
      }
      return lo;
    }

    function arena(id: UnitId, gap: number): { s: GameState; x: number } {
      const s = editable(startGame(engine, 1));
      const enemy = s.unitOrder.find((u) => s.units[u]!.owner !== s.units[id]!.owner)!;
      keepOnly(s, [id, enemy]);
      placeUnit(scenario, s, enemy, 10, 40, 0);
      placeUnit(scenario, s, id, 40, 17, 0);
      const x = xAtGap(s, id, gap);
      placeUnit(scenario, s, id, x, 17, 0);
      return { s, x };
    }

    const to = (s: GameState, id: UnitId, x: number, y: number, allowance: number): string[] => {
      const p = formPlacement(scenario, s.units[id]!, { x, y }, 0);
      return checkMovePlacement(scenario, s, s.units[id]!, p, { reason: 'normal', allowance }).map(
        (v) => v.code,
      );
    };

    it('touching the spire and moving straight away is free', () => {
      const { walker } = pick();
      const { s, x } = arena(walker, 0.001);
      expect(to(s, walker, x - 5, 17, 5.01)).not.toContain('TOO_FAR');
    });

    it('sliding along the face of the spire is free', () => {
      const { walker } = pick();
      const { s, x } = arena(walker, 0.001);
      expect(to(s, walker, x, 11, 6.01)).not.toContain('TOO_FAR');
    });

    it('an oval base 0.5" clear of the spire, moving away or along it, is free', () => {
      const { s, x } = arena(BASTILADON, 0.5);
      expect(to(s, BASTILADON, x - 5, 17, 5.01)).not.toContain('TOO_FAR');
      expect(to(s, BASTILADON, x, 11, 6.01)).not.toContain('TOO_FAR');
    });

    it('the message says how much of the cost is climbing', () => {
      const { walker } = pick();
      const c = crossing(walker);
      const v = checkMovePlacement(scenario, c.s, c.s.units[walker]!, c.p, {
        reason: 'normal',
        allowance: c.flat + 1,
      });
      expect(v.find((x) => x.code === 'TOO_FAR')!.message).toContain('including 8" climbing');
    });
  });

  it('the base counts, not the centre: an oval clipping the spire climbs it', () => {
    // The spire spans x 50.5..55.5; the centre line at x 57 misses it, the Bastiladon's base does not.
    const make = (x: number) => {
      const s = editable(startGame(engine, 1));
      const enemy = s.unitOrder.find((u) => s.units[u]!.owner === 0)!;
      keepOnly(s, ['1:7', enemy]);
      placeUnit(scenario, s, enemy, 10, 40, 0);
      placeUnit(scenario, s, '1:7', x, 25, 0);
      const p = formPlacement(scenario, s.units['1:7']!, { x, y: 10 }, 0);
      return { s, p };
    };
    const climb = 2 * climbHeight(spire);
    const clip = make(57);
    expect(codes(clip, '1:7', 15 + climb - 0.1)).toContain('TOO_FAR');
    expect(codes(clip, '1:7', 15 + climb + 0.01)).not.toContain('TOO_FAR');
    // Far enough east that the base clears the spire: no climb.
    const clear = make(59.5);
    expect(codes(clear, '1:7', 15.01)).not.toContain('TOO_FAR');
  });
});
