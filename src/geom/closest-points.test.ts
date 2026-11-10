import type { BaseShape } from '../data/schema/index.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as geometry from './geometry.js';
import {
  baseFootprint,
  distancePointToBoundary,
  footprintClosestPoints,
  footprintGap,
  footprintPolygon,
  footprintsOverlap,
  type Footprint,
  type ReadonlyPoint,
} from './index.js';
import { oval, round } from './test-helpers.js';

/** M5-T17 (ADR 0025 §3): closest points between two bases, for the measuring tool. */

const r32 = 32 / 2 / 25.4;
const rect50x25: BaseShape = { kind: 'rect', lengthMm: 50, widthMm: 25 };
const hw = 50 / 2 / 25.4;
const hh = 25 / 2 / 25.4;
const point = (x: number, y: number): Footprint => ({ kind: 'circle', cx: x, cy: y, r: 0 });
const dist = (p: ReadonlyPoint, q: ReadonlyPoint): number => Math.hypot(p[0] - q[0], p[1] - q[1]);

function expectPoint(actual: ReadonlyPoint, expected: ReadonlyPoint, tol = 1e-12): void {
  expect(dist(actual, expected)).toBeLessThanOrEqual(tol);
}

describe('footprintClosestPoints: exact cases', () => {
  it('is exported from @aos/deployment/geometry', () => {
    expect(geometry.footprintClosestPoints).toBe(footprintClosestPoints);
  });

  it('circle to circle: along the centre line, gap = centre distance - radii', () => {
    const a = baseFootprint(round(32), 10, 10);
    const b = baseFootprint(round(32), 13, 14); // 5" apart
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBeCloseTo(5 - 2 * r32, 12);
    expectPoint(r.a, [10 + 0.6 * r32, 10 + 0.8 * r32]);
    expectPoint(r.b, [13 - 0.6 * r32, 14 - 0.8 * r32]);
    expect(dist(r.a, r.b)).toBeCloseTo(r.gap, 12);
  });

  it('circle to circle of different sizes, and the order of the arguments', () => {
    const a = baseFootprint(round(25), 0, 0);
    const b = baseFootprint(round(100), 0, 6);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBeCloseTo(6 - 12.5 / 25.4 - 50 / 25.4, 12);
    expectPoint(r.a, [0, 12.5 / 25.4]);
    expectPoint(r.b, [0, 6 - 50 / 25.4]);
    const back = footprintClosestPoints(b, a);
    expect(back.gap).toBe(r.gap);
    expectPoint(back.a, r.b);
    expectPoint(back.b, r.a);
  });

  it('rect to rect, side by side: on the facing edges, at the same height', () => {
    const a = baseFootprint(rect50x25, 0, 0, 0);
    const b = baseFootprint(rect50x25, 5, 0.2, 0);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBeCloseTo(5 - 2 * hw, 12);
    expect(r.a[0]).toBeCloseTo(hw, 12);
    expect(r.b[0]).toBeCloseTo(5 - hw, 12);
    expect(r.a[1]).toBeCloseTo(r.b[1], 12);
    expect(Math.abs(r.a[1])).toBeLessThanOrEqual(hh + 1e-12);
    expect(Math.abs(r.b[1] - 0.2)).toBeLessThanOrEqual(hh + 1e-12);
  });

  it('rect to rect, diagonal: corner to corner', () => {
    const a = baseFootprint(rect50x25, 0, 0, 0);
    const b = baseFootprint(rect50x25, 5, 3, 0);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBeCloseTo(Math.hypot(5 - 2 * hw, 3 - 2 * hh), 12);
    expectPoint(r.a, [hw, hh]);
    expectPoint(r.b, [5 - hw, 3 - hh]);
  });

  it('rect rotated 90 degrees: the long side now runs along y', () => {
    const a = baseFootprint(rect50x25, 0, 0, 90);
    const b = baseFootprint(rect50x25, 0, 5, 90);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBeCloseTo(5 - 2 * hw, 12);
    expect(r.a[1]).toBeCloseTo(hw, 12);
    expect(r.b[1]).toBeCloseTo(5 - hw, 12);
  });

  it('circle to a rect rotated 45 degrees: to the corner', () => {
    const sq: BaseShape = { kind: 'rect', lengthMm: 40, widthMm: 40 };
    const h = 20 / 25.4;
    const a = baseFootprint(sq, 0, 0, 45);
    const b = baseFootprint(round(32), 4, 0);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBeCloseTo(4 - h * Math.SQRT2 - r32, 12);
    expectPoint(r.a, [h * Math.SQRT2, 0], 1e-12);
    expectPoint(r.b, [4 - r32, 0], 1e-12);
  });

  it('useModel bases measure as the 32mm fallback', () => {
    const a = baseFootprint({ kind: 'useModel' }, 0, 0);
    const b = baseFootprint(round(32), 3, 0);
    expect(footprintClosestPoints(a, b).gap).toBeCloseTo(3 - 2 * r32, 12);
  });

  it('a radius-0 circle is a free point', () => {
    const p = point(1, 2);
    const c = baseFootprint(round(40), 1, 6);
    const r = footprintClosestPoints(p, c);
    expect(r.gap).toBeCloseTo(4 - 20 / 25.4, 12);
    expect(r.a).toEqual([1, 2]);
    expectPoint(r.b, [1, 6 - 20 / 25.4]);
    // Two free points: the centre distance, as the ruler measured before ADR 0025.
    const two = footprintClosestPoints(point(0, 0), point(3, 4));
    expect(two).toEqual({ gap: 5, a: [0, 0], b: [3, 4] });
    // A free point to an oval: the point stays put, the other end is on the outline.
    const o = baseFootprint(oval(60, 35), 10, 10, 30);
    const po = footprintClosestPoints(point(14, 10), o);
    expect(po.a).toEqual([14, 10]);
    expect(distancePointToBoundary(po.b, footprintPolygon(o))).toBeLessThan(1e-12);
    expect(dist(po.a, po.b)).toBeCloseTo(po.gap, 12);
  });
});

describe('footprintClosestPoints: touching and overlapping (gap 0, never negative)', () => {
  it('touching circles: both points are the contact point', () => {
    const a = baseFootprint(round(32), 0, 0);
    const b = baseFootprint(round(32), 2 * r32, 0);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBe(0);
    expectPoint(r.a, [r32, 0]);
    expectPoint(r.b, [r32, 0]);
  });

  it('overlapping circles: gap 0, points on each outline along the centre line', () => {
    const a = baseFootprint(round(32), 0, 0);
    const b = baseFootprint(round(32), 0, 1);
    expect(footprintsOverlap(a, b)).toBe(true);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBe(0);
    expectPoint(r.a, [0, r32]);
    expectPoint(r.b, [0, 1 - r32]);
  });

  it('coincident centres: along +x', () => {
    const a = baseFootprint(rect50x25, 5, 5, 0);
    const b = baseFootprint(round(32), 5, 5);
    const r = footprintClosestPoints(a, b);
    expect(r.gap).toBe(0);
    expectPoint(r.a, [5 + hw, 5]);
    expectPoint(r.b, [5 - r32, 5]);
  });

  it('a free point inside a base: gap 0 and the point itself', () => {
    const rect = baseFootprint(rect50x25, 0, 0, 0);
    const r = footprintClosestPoints(point(0.3, 0.1), rect);
    expect(r.gap).toBe(0);
    expect(r.a).toEqual([0.3, 0.1]);
    expect(distancePointToBoundary(r.b, footprintPolygon(rect))).toBeLessThan(1e-12);
  });
});

/** Points on the measured outline: the circle itself, or every edge of the outer polygon. */
function sampleOutline(fp: Footprint, step: number): ReadonlyPoint[] {
  if (fp.kind === 'circle') {
    if (fp.r === 0) return [[fp.cx, fp.cy]];
    const n = Math.max(8, Math.ceil((2 * Math.PI * fp.r) / step));
    return Array.from({ length: n }, (_, i) => {
      const t = (2 * Math.PI * i) / n;
      return [fp.cx + fp.r * Math.cos(t), fp.cy + fp.r * Math.sin(t)] as const;
    });
  }
  const poly = footprintPolygon(fp);
  const pts: ReadonlyPoint[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as ReadonlyPoint;
    const q = poly[(i + 1) % poly.length] as ReadonlyPoint;
    const n = Math.max(1, Math.ceil(dist(p, q) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return pts;
}

function onOutline(p: ReadonlyPoint, fp: Footprint): number {
  if (fp.kind === 'circle') return Math.abs(dist(p, [fp.cx, fp.cy]) - fp.r);
  return distancePointToBoundary(p, footprintPolygon(fp));
}

describe('footprintClosestPoints: property against footprintGap and a sampled oracle', () => {
  it('random circles, ovals, rects and free points at any rotation (fixed seed)', () => {
    const STEP = 0.02; // sample spacing in inches; the oracle over-estimates by at most STEP
    const arbFp = fc
      .record({
        base: fc.oneof(
          fc.constantFrom(25, 32, 40, 60, 100).map(round),
          fc.constantFrom([60, 35] as const, [120, 92] as const).map(([l, w]) => oval(l, w)),
          fc.constantFrom<BaseShape>(rect50x25, { kind: 'rect', lengthMm: 100, widthMm: 40 }),
          fc.constant<BaseShape>({ kind: 'useModel' }),
          fc.constant(null), // a free point
        ),
        x: fc.double({ min: -5, max: 5, noNaN: true }),
        y: fc.double({ min: -5, max: 5, noNaN: true }),
        rotation: fc.double({ min: 0, max: 360, noNaN: true }),
      })
      .map(({ base, x, y, rotation }) =>
        base === null ? point(x, y) : baseFootprint(base, x, y, rotation),
      );
    fc.assert(
      fc.property(arbFp, arbFp, (a, b) => {
        const r = footprintClosestPoints(a, b);
        // Same gap as footprintGap (to 1e-9; in fact the same number), never negative.
        expect(Math.abs(r.gap - footprintGap(a, b))).toBeLessThanOrEqual(1e-9);
        expect(r.gap).toBeGreaterThanOrEqual(0);
        if (footprintsOverlap(a, b)) expect(r.gap).toBe(0);
        // Both points lie on the measured outlines (exact for circles).
        expect(onOutline(r.a, a)).toBeLessThanOrEqual(1e-9);
        expect(onOutline(r.b, b)).toBeLessThanOrEqual(1e-9);
        if (r.gap > 0) {
          // The line joins the closest points: its length is the gap.
          expect(Math.abs(dist(r.a, r.b) - r.gap)).toBeLessThanOrEqual(1e-9);
          // Sampled oracle: no pair of outline samples is closer than the gap, and the
          // closest sampled pair is within the sampling error of it.
          const sa = sampleOutline(a, STEP);
          const sb = sampleOutline(b, STEP);
          let oracle = Infinity;
          for (const p of sa) for (const q of sb) oracle = Math.min(oracle, dist(p, q));
          expect(oracle).toBeGreaterThanOrEqual(r.gap - 1e-9);
          expect(oracle - r.gap).toBeLessThanOrEqual(STEP);
        }
      }),
      { seed: 20261029, numRuns: 300 },
    );
  });
});
