import type { BaseShape } from '../data/schema/index.js';
import type { Polygon, ReadonlyPoint } from './polygon.js';
import fc from 'fast-check';
import type { Footprint } from './footprint.js';

export const round = (diameterMm: number): BaseShape => ({ kind: 'round', diameterMm });
export const oval = (lengthMm: number, widthMm: number): BaseShape => ({
  kind: 'oval',
  lengthMm,
  widthMm,
});

/** Base sizes seen in the AoS data. */
export const ROUND_SIZES = [25, 28.5, 32, 40, 50, 60, 80, 100, 130] as const;
export const OVAL_SIZES = [
  [60, 35],
  [75, 42],
  [90, 52],
  [105, 70],
  [120, 92],
  [170, 105],
] as const;

export const arbBase: fc.Arbitrary<BaseShape> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...ROUND_SIZES).map(round) },
  { weight: 1, arbitrary: fc.constantFrom(...OVAL_SIZES).map(([l, w]) => oval(l, w)) },
);

/** A unit: N copies of one base, optionally with 1-2 champion models on another base first. */
export const arbUnit: fc.Arbitrary<BaseShape[]> = fc
  .record({
    main: arbBase,
    count: fc.integer({ min: 1, max: 20 }),
    champions: fc.array(arbBase, { maxLength: 2 }),
  })
  .map(({ main, count, champions }) => [
    ...champions,
    ...Array.from({ length: count }, () => main),
  ]);

export function rect(x: number, y: number, w: number, h: number): Polygon {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** Points on the TRUE outline of a footprint (not the polygon approximation). */
export function outlinePoints(fp: Footprint, n = 72): ReadonlyPoint[] {
  const pts: ReadonlyPoint[] = [];
  const t = fp.kind === 'circle' ? 0 : (fp.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    let lx: number;
    let ly: number;
    if (fp.kind === 'circle') {
      lx = fp.r * Math.cos(a);
      ly = fp.r * Math.sin(a);
    } else if (fp.kind === 'ellipse') {
      lx = fp.rx * Math.cos(a);
      ly = fp.ry * Math.sin(a);
    } else {
      const k = Math.max(Math.abs(Math.cos(a)) / fp.hw, Math.abs(Math.sin(a)) / fp.hh);
      lx = Math.cos(a) / k;
      ly = Math.sin(a) / k;
    }
    pts.push([fp.cx + lx * c - ly * s, fp.cy + lx * s + ly * c]);
  }
  return pts;
}

/** Exact "strictly inside the true shape" test (circle / ellipse / rect). */
export function strictlyInsideShape(fp: Footprint, p: ReadonlyPoint, eps = 1e-9): boolean {
  const dx = p[0] - fp.cx;
  const dy = p[1] - fp.cy;
  if (fp.kind === 'circle') return Math.hypot(dx, dy) < fp.r - eps;
  const t = (-fp.rotation * Math.PI) / 180;
  const lx = dx * Math.cos(t) - dy * Math.sin(t);
  const ly = dx * Math.sin(t) + dy * Math.cos(t);
  if (fp.kind === 'ellipse') return (lx / fp.rx) ** 2 + (ly / fp.ry) ** 2 < 1 - eps;
  return Math.abs(lx) < fp.hw - eps && Math.abs(ly) < fp.hh - eps;
}

/** Independent oracle: do the TRUE shapes overlap? (sampled outlines + centres) */
export function trulyOverlap(a: Footprint, b: Footprint): boolean {
  if (a.kind === 'circle' && b.kind === 'circle')
    return Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r - 1e-9;
  if (strictlyInsideShape(b, [a.cx, a.cy]) || strictlyInsideShape(a, [b.cx, b.cy])) return true;
  return (
    outlinePoints(a, 180).some((p) => strictlyInsideShape(b, p)) ||
    outlinePoints(b, 180).some((p) => strictlyInsideShape(a, p))
  );
}

/** Smaller units (up to 10 models, at most 1 champion) that fit in a deployment zone. */
export const arbSmallUnit: fc.Arbitrary<BaseShape[]> = fc
  .record({
    main: arbBase,
    count: fc.integer({ min: 1, max: 10 }),
    champions: fc.array(arbBase, { maxLength: 1 }),
  })
  .map(({ main, count, champions }) => [
    ...champions,
    ...Array.from({ length: count }, () => main),
  ]);

/** `arr[i]`, failing the test when it is missing (avoids non-null assertions). */
export function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
}
