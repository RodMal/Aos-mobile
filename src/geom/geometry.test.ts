import type { BaseShape } from '../data/schema/index.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  baseFootprint,
  convexPolygonsDistance,
  convexPolygonsOverlap,
  distancePointToBoundary,
  footprintDistanceToPolygon,
  footprintGapAtLeast,
  footprintGap,
  footprintInsidePolygon,
  footprintOverlapsPolygon,
  footprintPolygon,
  footprintsOverlap,
  pointInPolygon,
  pointLocation,
  polygonDistance,
  polygonInsidePolygon,
  polygonsOverlap,
  type Polygon,
} from './index.js';
import { outlinePoints, oval, rect, round } from './test-helpers.js';

/** U-shaped (concave) zone: a 30x10 block with a 10x6 notch cut from the top middle. */
const U: Polygon = [
  [0, 0],
  [10, 0],
  [10, 6],
  [20, 6],
  [20, 0],
  [30, 0],
  [30, 10],
  [0, 10],
];

const r32 = 32 / 2 / 25.4;

describe('point in polygon', () => {
  it('handles concave polygons and boundaries', () => {
    expect(pointInPolygon([5, 3], U)).toBe(true);
    expect(pointInPolygon([15, 3], U)).toBe(false); // in the notch
    expect(pointInPolygon([15, 8], U)).toBe(true);
    expect(pointLocation([15, 6], U)).toBe('boundary');
    expect(pointLocation([10, 3], U)).toBe('boundary');
    expect(pointInPolygon([31, 5], U)).toBe(false);
  });
});

describe('polygon wholly inside polygon (concave zone, edge crossings)', () => {
  it('accepts a polygon inside an arm of the U and one touching the boundary', () => {
    expect(polygonInsidePolygon(rect(1, 1, 8, 8), U)).toBe(true);
    expect(polygonInsidePolygon(rect(0, 6, 30, 4), U)).toBe(true);
    expect(polygonInsidePolygon(U, U)).toBe(true);
  });

  it('rejects a rectangle spanning the notch although all its corners are inside', () => {
    const bridge = rect(5, 1, 20, 2); // corners (5,1),(25,1),(25,3),(5,3) all inside the arms
    expect(bridge.every((p) => pointInPolygon(p, U))).toBe(true);
    expect(polygonInsidePolygon(bridge, U)).toBe(false);
  });

  it('rejects an edge that crosses the boundary between two inside vertices', () => {
    const tri: Polygon = [
      [8, 2],
      [22, 2],
      [15, 9],
    ];
    expect(tri.every((p) => pointInPolygon(p, U))).toBe(true);
    expect(polygonInsidePolygon(tri, U)).toBe(false);
  });

  it('rejects a polygon that sticks out of the outer one', () => {
    expect(polygonInsidePolygon(rect(25, 5, 10, 2), U)).toBe(false);
  });
});

describe('bases in a concave zone', () => {
  it('a circle next to the reflex corner of the notch is out, even with its centre inside', () => {
    // Centre (10.5, 6.5) is inside the U, but the reflex corner (10,6) is 0.707" away < r.
    const fp = baseFootprint(round(40), 10.5, 6.5);
    expect(pointInPolygon([10.5, 6.5], U)).toBe(true);
    expect(footprintInsidePolygon(fp, U)).toBe(false);
    expect(footprintInsidePolygon(baseFootprint(round(40), 10.5, 8.5), U)).toBe(true);
  });

  it('a circle touching the zone edge from inside is in (exact)', () => {
    expect(footprintInsidePolygon(baseFootprint(round(32), r32, 5), U)).toBe(true);
    expect(footprintInsidePolygon(baseFootprint(round(32), r32 - 1e-3, 5), U)).toBe(false);
  });
});

describe('ellipse rotation', () => {
  // 60x35mm oval: half-length 1.181", half-width 0.689".
  const half = 30 / 25.4;
  const halfW = 17.5 / 25.4;
  const zone = rect(0, 0, 10, 10);

  it('an axis-aligned oval flush against an edge is inside (outer polygon extents are exact)', () => {
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), half, 5, 0), zone)).toBe(true);
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), 5, 10 - halfW, 0), zone)).toBe(true);
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), halfW, 5, 90), zone)).toBe(true);
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), half - 1e-4, 5, 0), zone)).toBe(
      false,
    );
  });

  it('length runs along x at 0 degrees and along y at 90 degrees', () => {
    const x = half + 0.02; // the half-length fits between the centre and the wall
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), x, 5, 0), zone)).toBe(true);
    const xTight = halfW + 0.02; // only the half-width fits between the centre and the wall
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), xTight, 5, 0), zone)).toBe(false);
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), xTight, 5, 90), zone)).toBe(true);
    expect(footprintInsidePolygon(baseFootprint(oval(60, 35), xTight, 5, 270), zone)).toBe(true);
  });

  it('rotated outlines match the polygon: every true outline point lies inside the polygon', () => {
    for (const rotation of [0, 17, 45, 90, 133, 300]) {
      const fp = baseFootprint(oval(105, 70), 3, 4, rotation);
      const poly = footprintPolygon(fp);
      for (const p of outlinePoints(fp)) expect(pointInPolygon(p, poly)).toBe(true);
    }
  });

  it('distance to an edge depends on the rotation', () => {
    const wall = rect(-10, -10, 10, 20); // x <= 0
    const at0 = footprintDistanceToPolygon(baseFootprint(oval(60, 35), 3, 0, 0), wall);
    const at90 = footprintDistanceToPolygon(baseFootprint(oval(60, 35), 3, 0, 90), wall);
    expect(at0).toBeCloseTo(3 - half, 1);
    expect(at90).toBeCloseTo(3 - halfW, 1);
    expect(at0).toBeLessThanOrEqual(3 - half + 1e-9); // conservative (outer polygon)
  });

  it('two ovals side by side overlap or not depending on rotation', () => {
    const a = baseFootprint(oval(60, 35), 0, 0, 90);
    const b = baseFootprint(oval(60, 35), 1.5, 0, 90);
    expect(footprintsOverlap(a, b)).toBe(false); // 1.5 > 2 * 0.689
    expect(
      footprintsOverlap(
        baseFootprint(oval(60, 35), 0, 0, 0),
        baseFootprint(oval(60, 35), 1.5, 0, 0),
      ),
    ).toBe(true);
  });
});

describe('base-base overlap and gaps', () => {
  it('tangent circles do not overlap; a hair closer they do', () => {
    const a = baseFootprint(round(32), 0, 0);
    expect(footprintsOverlap(a, baseFootprint(round(32), 2 * r32, 0))).toBe(false);
    expect(footprintGap(a, baseFootprint(round(32), 2 * r32, 0))).toBeCloseTo(0, 12);
    expect(footprintsOverlap(a, baseFootprint(round(32), 2 * r32 - 1e-6, 0))).toBe(true);
  });

  it('mixed sizes: exact circle-circle gap', () => {
    const a = baseFootprint(round(40), 0, 0);
    const b = baseFootprint(round(25), 0, 3);
    expect(footprintGap(a, b)).toBeCloseTo(3 - 20 / 25.4 - 12.5 / 25.4, 12);
  });

  it('circle vs ellipse uses SAT on the polygons', () => {
    const e = baseFootprint(oval(60, 35), 0, 0, 0);
    expect(footprintsOverlap(e, baseFootprint(round(25), half() + 0.4, 0))).toBe(true);
    expect(footprintsOverlap(e, baseFootprint(round(25), half() + 0.6, 0))).toBe(false);
    expect(footprintGap(e, baseFootprint(round(25), half() + 1, 0))).toBeCloseTo(
      1 - 12.5 / 25.4,
      1,
    );
  });
});

function half(): number {
  return 30 / 25.4;
}

describe('base vs region', () => {
  it('distance from a base to a polygon is 0 when touching or inside, else edge to edge', () => {
    const territory = rect(0, 0, 60, 22);
    expect(
      footprintDistanceToPolygon(baseFootprint(round(32), 30, 31 + r32), territory),
    ).toBeCloseTo(9, 12);
    expect(footprintDistanceToPolygon(baseFootprint(round(32), 30, 22 + r32), territory)).toBe(0);
    expect(footprintDistanceToPolygon(baseFootprint(round(32), 30, 10), territory)).toBe(0);
  });

  it('touching blocking terrain is fine, overlapping it is not', () => {
    const terrain = rect(10, 10, 4, 4);
    expect(footprintOverlapsPolygon(baseFootprint(round(32), 14 + r32, 12), terrain)).toBe(false);
    expect(footprintOverlapsPolygon(baseFootprint(round(32), 14 + r32 - 0.01, 12), terrain)).toBe(
      true,
    );
    expect(footprintOverlapsPolygon(baseFootprint(oval(60, 35), 12, 12, 45), terrain)).toBe(true);
    expect(footprintOverlapsPolygon(baseFootprint(oval(60, 35), 20, 12, 45), terrain)).toBe(false);
  });
});

/**
 * M4-T21: `footprintOverlapsPolygon` exits early when the base is outside the region's
 * bounding box. This is the exact test it ran before (the oracle); results must be equal.
 */
function exactOverlapsPolygon(fp: ReturnType<typeof baseFootprint>, poly: Polygon): boolean {
  if (fp.kind === 'circle') {
    return (
      pointInPolygon([fp.cx, fp.cy], poly) ||
      distancePointToBoundary([fp.cx, fp.cy], poly) < fp.r - 1e-9
    );
  }
  return polygonsOverlap(footprintPolygon(fp), poly, 1e-9);
}

/** Bounding box of a base's outer polygon (what the exact polygon test sees). */
function outerBox(fp: ReturnType<typeof baseFootprint>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const pts = footprintPolygon(fp);
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxY: Math.max(...pts.map((p) => p[1])),
  };
}

const rect50x25: BaseShape = { kind: 'rect', lengthMm: 50, widthMm: 25 };
/** Offsets from exact touching (inches): overlap, touch, inside and beyond the 1e-6 margin. */
const NEAR = [-0.01, -1e-6, -1e-9, -1e-12, 0, 1e-12, 1e-9, 5e-7, 1e-6, 2e-6, 1e-3, 0.5];

describe('base vs region: bounding-box early exit keeps exact results (M4-T21)', () => {
  const terrain = rect(10, 10, 4, 4);

  it('round bases: touching and near misses beside, above and at a corner of the region', () => {
    for (const d of NEAR) {
      const right = baseFootprint(round(32), 14 + r32 + d, 12);
      const above = baseFootprint(round(32), 12, 10 - r32 - d);
      const corner = baseFootprint(
        round(32),
        14 + (r32 + d) / Math.SQRT2,
        14 + (r32 + d) / Math.SQRT2,
      );
      for (const fp of [right, above, corner])
        expect(footprintOverlapsPolygon(fp, terrain)).toBe(exactOverlapsPolygon(fp, terrain));
    }
    // Exact semantics: touching is not overlap, a hair inside (beyond EPS) is.
    expect(footprintOverlapsPolygon(baseFootprint(round(32), 14 + r32, 12), terrain)).toBe(false);
    expect(footprintOverlapsPolygon(baseFootprint(round(32), 14 + r32 - 1e-6, 12), terrain)).toBe(
      true,
    );
    expect(footprintOverlapsPolygon(baseFootprint(round(32), 14 + r32 + 1e-6, 12), terrain)).toBe(
      false,
    );
  });

  it('oval and rect bases: their outer polygon touching or just missing each side', () => {
    for (const base of [oval(60, 35), oval(170, 105), rect50x25])
      for (const rot of [0, 15, 45, 90, 137])
        for (const d of NEAR) {
          const probe = baseFootprint(base, 0, 0, rot);
          const b = outerBox(probe);
          const fps = [
            baseFootprint(base, 14 - b.minX + d, 12, rot), // right of the region
            baseFootprint(base, 10 - b.maxX - d, 12, rot), // left
            baseFootprint(base, 12, 10 - b.maxY - d, rot), // above
            baseFootprint(base, 12, 14 - b.minY + d, rot), // below
          ];
          for (const fp of fps) {
            const want = exactOverlapsPolygon(fp, terrain);
            expect(footprintOverlapsPolygon(fp, terrain)).toBe(want);
            if (d < -1e-6) expect(want).toBe(true);
            if (d > 1e-6) expect(want).toBe(false);
          }
        }
  });

  it('containment either way counts as overlap; a concave notch is not overlap', () => {
    // Base wholly inside the region.
    expect(footprintOverlapsPolygon(baseFootprint(round(25), 12, 12), terrain)).toBe(true);
    expect(footprintOverlapsPolygon(baseFootprint(rect50x25, 12, 12, 30), terrain)).toBe(true);
    // Region wholly inside the base (its box inside the base's box).
    const pebble = rect(29.9, 19.9, 0.2, 0.2);
    expect(footprintOverlapsPolygon(baseFootprint(round(130), 30, 20), pebble)).toBe(true);
    expect(footprintOverlapsPolygon(baseFootprint(oval(170, 105), 30, 20, 45), pebble)).toBe(true);
    expect(footprintOverlapsPolygon(baseFootprint(rect50x25, 30, 20, 10), pebble)).toBe(true);
    // Inside the U's bounding box but in its notch: no early exit, and still no overlap.
    expect(footprintOverlapsPolygon(baseFootprint(round(25), 15, 2), U)).toBe(false);
    expect(footprintOverlapsPolygon(baseFootprint(rect50x25, 15, 2.5, 0), U)).toBe(false);
    expect(footprintOverlapsPolygon(baseFootprint(round(130), 15, 4), U)).toBe(true);
  });

  it('agrees with the exact test on random bases near random regions', () => {
    const arbShape = fc.oneof(
      fc.constantFrom(25, 32, 40, 60, 100, 130).map(round),
      fc
        .constantFrom([60, 35] as const, [120, 92] as const, [170, 105] as const)
        .map(([l, w]) => oval(l, w)),
      fc.constantFrom<BaseShape>(rect50x25, { kind: 'rect', lengthMm: 100, widthMm: 40 }),
    );
    fc.assert(
      fc.property(
        arbShape,
        fc.double({ min: -5, max: 35, noNaN: true }),
        fc.double({ min: -5, max: 15, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.constantFrom(U, terrain, rect(3, 3, 0.3, 0.3)),
        (base, x, y, rot, poly) => {
          const fp = baseFootprint(base, x, y, rot);
          expect(footprintOverlapsPolygon(fp, poly)).toBe(exactOverlapsPolygon(fp, poly));
        },
      ),
      { numRuns: 3000, seed: 2026_11_03 },
    );
  });
});

describe('GJK regression: near-coincident overlapping shapes', () => {
  it('identical rects 5.6e-8" apart overlap, so their distance is exactly 0', () => {
    // Seed -1687914593: an absolute GJK stop tolerance reported ~5e-8 here instead of 0.
    const rect50x25: BaseShape = { kind: 'rect', lengthMm: 50, widthMm: 25 };
    const a = baseFootprint(rect50x25, 0, -5.5901699463900556e-8, 0);
    const b = baseFootprint(rect50x25, 0, 0, 0);
    expect(footprintGap(a, b)).toBe(0);
    expect(convexPolygonsDistance(footprintPolygon(a), footprintPolygon(b))).toBe(0);
    expect(footprintsOverlap(a, b)).toBe(true);
  });
});

/**
 * Distances agree to 1e-6" absolute plus 1e-9 relative. Both algorithms are exact up to
 * float rounding; near contact the brute force snaps to 0 within 1e-9 while GJK converges to
 * ~1e-8, and the relative part covers rounding that grows with the coordinates.
 */
function expectNear(actual: number, expected: number): void {
  const tol = 1e-6 + 1e-9 * Math.max(Math.abs(actual), Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe('convex distance (GJK) agrees with the brute-force polygon distance', () => {
  it('property: random rotated ovals, circles and rectangles', () => {
    const arbFp = fc
      .record({
        base: fc.oneof(
          fc.constantFrom(25, 32, 40, 100).map(round),
          fc.constantFrom([60, 35] as const, [120, 92] as const).map(([l, w]) => oval(l, w)),
          fc.constant<BaseShape>({ kind: 'rect', lengthMm: 50, widthMm: 25 }),
        ),
        x: fc.double({ min: -4, max: 4, noNaN: true }),
        y: fc.double({ min: -4, max: 4, noNaN: true }),
        rotation: fc.double({ min: 0, max: 360, noNaN: true }),
      })
      .map(({ base, x, y, rotation }) => baseFootprint(base, x, y, rotation));
    const rect50x25: BaseShape = { kind: 'rect', lengthMm: 50, widthMm: 25 };
    fc.assert(
      fc.property(arbFp, arbFp, (a, b) => {
        const pa = footprintPolygon(a);
        const pb = footprintPolygon(b);
        expectNear(convexPolygonsDistance(pa, pb), polygonDistance(pa, pb));
        if (a.kind !== 'circle' && b.kind !== 'circle') {
          expectNear(footprintGap(a, b), polygonDistance(pa, pb));
          expect(footprintsOverlap(a, b)).toBe(convexPolygonsOverlap(pa, pb));
        } else if (a.kind === 'circle' && b.kind !== 'circle') {
          // Circles are exact: centre-to-polygon distance minus the radius.
          const c: [number, number] = [a.cx, a.cy];
          const d = pointInPolygon(c, pb) ? 0 : distancePointToBoundary(c, pb);
          expectNear(footprintGap(a, b), Math.max(0, d - a.r));
          if (Math.abs(d - a.r) > 1e-6) expect(footprintsOverlap(a, b)).toBe(d < a.r);
        }
        for (const t of [0.1, 0.5, 1]) {
          const gap = footprintGap(a, b);
          // Skip the knife edge where float noise may decide either way.
          if (Math.abs(gap - t) > 1e-9) expect(footprintGapAtLeast(a, b, t)).toBe(gap >= t);
        }
      }),
      {
        numRuns: 500,
        seed: 20261103,
        // Regression (seed -1687914593): identical rects 5.6e-8" apart, i.e. overlapping;
        // GJK used to stop early and report 5e-8 instead of 0.
        examples: [
          [
            baseFootprint(rect50x25, 0, -5.5901699463900556e-8, 0),
            baseFootprint(rect50x25, 0, 0, 0),
          ],
        ],
      },
    );
  });
});
