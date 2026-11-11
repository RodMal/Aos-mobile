import {
  distancePointToBoundary,
  pointInPolygon,
  polygonDistance,
  polygonInsidePolygon,
  polygonsOverlap,
  type Point,
  type Polygon,
  type ReadonlyPoint,
} from './polygon.js';
import {
  boundingRadius,
  footprintPolygon,
  halfExtents,
  innerLocalPolygon,
  localPolygon,
  type Footprint,
} from './footprint.js';
import { BASE_POLYGON_SEGMENTS, EPS } from './units.js';

export {
  distancePointToBoundary,
  pointInPolygon,
  pointLocation,
  pointStrictlyInPolygon,
  polygonDistance,
  polygonInsidePolygon,
  polygonsOverlap,
  shapeToPolygon,
  type Point,
  type Polygon,
  type ReadonlyPoint,
} from './polygon.js';

/**
 * True when the whole footprint lies inside or on `poly` (which may be concave). Circles are
 * exact (centre inside and at least r from every edge); other shapes use their outer
 * polygon, so the test never accepts a base that pokes out.
 */
export function footprintInsidePolygon(fp: Footprint, poly: Polygon): boolean {
  if (fp.kind === 'polygon') return polygonInsidePolygon(fp.outline, poly, EPS);
  if (fp.kind === 'circle') {
    const c: ReadonlyPoint = [fp.cx, fp.cy];
    return pointInPolygon(c, poly) && distancePointToBoundary(c, poly) >= fp.r - EPS;
  }
  return polygonInsidePolygon(footprintPolygon(fp), poly, EPS);
}

/** Shortest distance from the edge of the base to the region `poly`; 0 if they touch. */
export function footprintDistanceToPolygon(fp: Footprint, poly: Polygon): number {
  if (fp.kind === 'polygon') return polygonDistance(fp.outline, poly);
  if (fp.kind === 'circle') {
    const c: ReadonlyPoint = [fp.cx, fp.cy];
    if (pointInPolygon(c, poly)) return 0;
    return Math.max(0, distancePointToBoundary(c, poly) - fp.r);
  }
  return polygonDistance(footprintPolygon(fp), poly);
}

/** Axis-aligned bounding box of a polygon. */
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding boxes of the region polygons seen by `footprintOverlapsPolygon` (never mutated). */
const polygonBoxes = new WeakMap<Polygon, Box>();

function polygonBox(poly: Polygon): Box {
  let box = polygonBoxes.get(poly);
  if (!box) {
    box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [x, y] of poly) {
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
    polygonBoxes.set(poly, box);
  }
  return box;
}

/**
 * Margin (inches) of the bounding-box early exit in `footprintOverlapsPolygon`. It is far
 * larger than the exact tests' tolerances (EPS, GEOMETRY_EPS = 1e-9) and floating-point error,
 * so the exit only fires where the exact test is sure to return false: touching and near-miss
 * cases within the margin still run the exact test.
 */
const BOX_EXIT_MARGIN_IN = 1e-6;

/**
 * Half-extent scale that bounds the circumscribed 24-gon used for ellipses: that polygon lies
 * inside the ellipse scaled by 1 / cos(pi / n) (see `footprintPolygon`).
 */
const ELLIPSE_POLYGON_SCALE = 1 / Math.cos(Math.PI / BASE_POLYGON_SEGMENTS);

/**
 * True when the base and the region `poly` share area (touching does not count).
 *
 * Bounding-box early exit (M4-T21): when the base lies more than `BOX_EXIT_MARGIN_IN` outside
 * the region's bounding box, the region (inside its box) cannot share area with it, so the
 * answer is false without the polygon test. Otherwise the exact test below decides, so the
 * result is identical to running it alone.
 */
export function footprintOverlapsPolygon(fp: Footprint, poly: Polygon): boolean {
  if (fp.kind === 'polygon') return polygonsOverlap(fp.outline, poly, EPS);
  const box = polygonBox(poly);
  if (fp.kind === 'circle') {
    // Distance from the centre to the box is a lower bound of the distance to the region.
    const dx = Math.max(box.minX - fp.cx, 0, fp.cx - box.maxX);
    const dy = Math.max(box.minY - fp.cy, 0, fp.cy - box.maxY);
    if (Math.sqrt(dx * dx + dy * dy) > fp.r + BOX_EXIT_MARGIN_IN) return false;
    const c: ReadonlyPoint = [fp.cx, fp.cy];
    return pointInPolygon(c, poly) || distancePointToBoundary(c, poly) < fp.r - EPS;
  }
  // Half extents of the box of the base's outer polygon (exact corners for rectangles).
  const { hx, hy } = halfExtents(fp);
  const scale = fp.kind === 'ellipse' ? ELLIPSE_POLYGON_SCALE : 1;
  const ex = hx * scale + BOX_EXIT_MARGIN_IN;
  const ey = hy * scale + BOX_EXIT_MARGIN_IN;
  if (
    fp.cx - ex > box.maxX ||
    fp.cx + ex < box.minX ||
    fp.cy - ey > box.maxY ||
    fp.cy + ey < box.minY
  )
    return false;
  return polygonsOverlap(footprintPolygon(fp), poly, EPS);
}

function project(poly: Polygon, nx: number, ny: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of poly) {
    const d = v[0] * nx + v[1] * ny;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

function separatedOn(a: Polygon, b: Polygon, nx: number, ny: number): boolean {
  const len = Math.hypot(nx, ny);
  if (len === 0) return false;
  const [minA, maxA] = project(a, nx / len, ny / len);
  const [minB, maxB] = project(b, nx / len, ny / len);
  return maxA <= minB + EPS || maxB <= minA + EPS;
}

function centroid(poly: Polygon): ReadonlyPoint {
  let x = 0;
  let y = 0;
  for (const v of poly) {
    x += v[0];
    y += v[1];
  }
  return [x / poly.length, y / poly.length];
}

/** Separating-axis test for two convex polygons; touching does not count as overlap. */
export function convexPolygonsOverlap(a: Polygon, b: Polygon): boolean {
  // Any separating axis proves separation; the centre-to-centre direction usually is one.
  const ca = centroid(a);
  const cb = centroid(b);
  if (separatedOn(a, b, cb[0] - ca[0], cb[1] - ca[1])) return false;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as ReadonlyPoint;
      const q = poly[(i + 1) % poly.length] as ReadonlyPoint;
      if (separatedOn(a, b, q[1] - p[1], p[0] - q[0])) return false;
    }
  }
  return true;
}

function support(poly: Polygon, dx: number, dy: number): ReadonlyPoint {
  let best = poly[0] as ReadonlyPoint;
  let bestDot = -Infinity;
  for (const v of poly) {
    const d = v[0] * dx + v[1] * dy;
    if (d > bestDot) {
      bestDot = d;
      best = v;
    }
  }
  return best;
}

/** Closest point to the origin on segment a-b, and the barycentric weight of b. */
function closestOnSegment(a: ReadonlyPoint, b: ReadonlyPoint): [ReadonlyPoint, number] {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey;
  if (len2 === 0) return [a, 0];
  const t = Math.max(0, Math.min(1, -(a[0] * ex + a[1] * ey) / len2));
  return [[a[0] + t * ex, a[1] + t * ey], t];
}

/**
 * Distance between two convex polygons (0 when they touch or overlap), by GJK on the
 * Minkowski difference a - b. Each iteration is O(n + m); a few iterations suffice.
 */
export function convexPolygonsDistance(a: Polygon, b: Polygon): number {
  return convexDistanceOffset(a, b, 0, 0);
}

/** {@link convexPolygonsDistance} with `a` translated by (ox, oy). */
function convexDistanceOffset(a: Polygon, b: Polygon, ox: number, oy: number): number {
  const diffSupport = (dx: number, dy: number): ReadonlyPoint => {
    const p = support(a, dx, dy);
    const q = support(b, -dx, -dy);
    return [p[0] - q[0] + ox, p[1] - q[1] + oy];
  };
  const a0 = a[0] as ReadonlyPoint;
  const b0 = b[0] as ReadonlyPoint;
  let v: ReadonlyPoint = [a0[0] - b0[0] + ox, a0[1] - b0[1] + oy];
  let simplex: ReadonlyPoint[] = [v];
  for (let it = 0; it < 64; it++) {
    const vv = v[0] * v[0] + v[1] * v[1];
    if (vv <= EPS * EPS) return 0;
    const w = diffSupport(-v[0], -v[1]);
    // No point of the difference is closer than v in direction v: v is the answer. The
    // tolerance is RELATIVE to |v|^2: an absolute one would stop early when v is tiny and
    // report overlapping shapes as ~1e-8 apart instead of 0.
    if (vv - (v[0] * w[0] + v[1] * w[1]) <= 1e-12 * vv) return Math.sqrt(vv);
    simplex.push(w);
    if (simplex.length === 2) {
      const [p, t] = closestOnSegment(simplex[0] as ReadonlyPoint, simplex[1] as ReadonlyPoint);
      v = p;
      if (t === 0) simplex = [simplex[0] as ReadonlyPoint];
      else if (t === 1) simplex = [simplex[1] as ReadonlyPoint];
    } else {
      const [s0, s1, s2] = simplex as [ReadonlyPoint, ReadonlyPoint, ReadonlyPoint];
      const o: ReadonlyPoint = [0, 0];
      const c1 = cross2(s0, s1, o);
      const c2 = cross2(s1, s2, o);
      const c3 = cross2(s2, s0, o);
      if ((c1 >= 0 && c2 >= 0 && c3 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0)) return 0;
      // Keep the edge whose closest point is nearest the origin.
      let bestPoint: ReadonlyPoint = s0;
      let bestD = Infinity;
      let bestSimplex: ReadonlyPoint[] = [s0];
      for (const [p0, p1] of [
        [s0, s1],
        [s1, s2],
        [s2, s0],
      ] as const) {
        const [p, t] = closestOnSegment(p0, p1);
        const d = p[0] * p[0] + p[1] * p[1];
        if (d < bestD) {
          bestD = d;
          bestPoint = p;
          bestSimplex = t === 0 ? [p0] : t === 1 ? [p1] : [p0, p1];
        }
      }
      v = bestPoint;
      simplex = bestSimplex;
    }
    const nv = v[0] * v[0] + v[1] * v[1];
    if (nv >= vv * (1 - 1e-12)) return Math.sqrt(Math.min(nv, vv));
  }
  return Math.hypot(v[0], v[1]);
}

function cross2(a: ReadonlyPoint, b: ReadonlyPoint, c: ReadonlyPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

const ORIGIN: Polygon = [[0, 0]];

/** Distance from the centre of circle `c` to the outer polygon of `other` (0 if inside). */
function centreToPolygon(c: Footprint, other: Footprint): number {
  return convexDistanceOffset(ORIGIN, localPolygon(other), c.cx - other.cx, c.cy - other.cy);
}

/** Radius of the largest circle around the centre that fits inside the footprint. */
function innerRadius(fp: Footprint): number {
  switch (fp.kind) {
    case 'circle':
      return fp.r;
    case 'ellipse':
      return Math.min(fp.rx, fp.ry);
    case 'rect':
      return Math.min(fp.hw, fp.hh);
    case 'polygon':
      return 0;
  }
}

/**
 * Radius of the circle around the shape `footprintsOverlap` tests (the circle itself, or the
 * outer polygon): bases whose centres are at least the sum of these apart never overlap.
 */
export function footprintOuterRadius(fp: Footprint): number {
  return outerRadius(fp);
}

function outerRadius(fp: Footprint): number {
  // Radius of the circle around the outer polygon (circumscribed 24-gon or rect corners).
  switch (fp.kind) {
    case 'circle':
      return fp.r; // circles are tested exactly, never through their polygon
    case 'ellipse':
      return Math.max(fp.rx, fp.ry) / Math.cos(Math.PI / BASE_POLYGON_SEGMENTS);
    case 'rect':
      return Math.hypot(fp.hw, fp.hh);
    case 'polygon':
      return boundingRadius(fp);
  }
}

/**
 * True when two bases overlap; touching does not count. Circles are always exact (against
 * another circle, or against the other base's outer polygon), so results do not depend on
 * how a circle's polygon happens to be oriented. Ellipses and rectangles use SAT on their
 * outer polygons, which rotate with the base.
 */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  if (a.kind === 'polygon' || b.kind === 'polygon') {
    if (Math.hypot(a.cx - b.cx, a.cy - b.cy) >= outerRadius(a) + outerRadius(b)) return false;
    if (a.kind === 'circle') return circleOverlapsOutline(a, outlineOf(b));
    if (b.kind === 'circle') return circleOverlapsOutline(b, outlineOf(a));
    return polygonsOverlap(outlineOf(a), outlineOf(b), EPS);
  }
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  if (a.kind === 'circle' && b.kind === 'circle') return d < a.r + b.r - EPS;
  if (d >= outerRadius(a) + outerRadius(b)) return false;
  if (d < innerRadius(a) + innerRadius(b) - EPS) return true;
  if (a.kind === 'circle') return centreToPolygon(a, b) < a.r - EPS;
  if (b.kind === 'circle') return centreToPolygon(b, a) < b.r - EPS;
  return convexPolygonsOverlap(footprintPolygon(a), footprintPolygon(b));
}

/**
 * Edge-to-edge distance between two bases in inches; 0 when they touch or overlap.
 * Exact for two circles; otherwise measured against the outer polygons of ellipses and
 * rectangles (which can only under-estimate the true gap, by under 1% of the radius).
 */
export function footprintGap(a: Footprint, b: Footprint): number {
  if (a.kind === 'polygon' || b.kind === 'polygon') return outlineGap(a, b);
  if (a.kind === 'circle' && b.kind === 'circle') {
    return Math.max(0, Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r);
  }
  if (a.kind === 'circle') return Math.max(0, centreToPolygon(a, b) - a.r);
  if (b.kind === 'circle') return Math.max(0, centreToPolygon(b, a) - b.r);
  return convexDistanceOffset(localPolygon(a), localPolygon(b), a.cx - b.cx, a.cy - b.cy);
}

/** Result of {@link footprintClosestPoints}: the gap and a point on each outline (inches). */
export interface FootprintClosestPoints {
  /** Edge-to-edge distance; exactly `footprintGap(a, b)`, so 0 (never negative) on overlap. */
  gap: number;
  /** Point on the outline of the first footprint. */
  a: Point;
  /** Point on the outline of the second footprint. */
  b: Point;
}

/** Closest point to `p` on segment q0-q1. */
function closestOnSegmentTo(p: ReadonlyPoint, q0: ReadonlyPoint, q1: ReadonlyPoint): Point {
  const ex = q1[0] - q0[0];
  const ey = q1[1] - q0[1];
  const len2 = ex * ex + ey * ey;
  if (len2 === 0) return [q0[0], q0[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - q0[0]) * ex + (p[1] - q0[1]) * ey) / len2));
  return [q0[0] + t * ex, q0[1] + t * ey];
}

/** Closest point to `p` on the boundary of the convex polygon `poly`. */
function closestOnBoundary(p: ReadonlyPoint, poly: Polygon): Point {
  let best: Point = [p[0], p[1]];
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegmentTo(
      p,
      poly[i] as ReadonlyPoint,
      poly[(i + 1) % poly.length] as ReadonlyPoint,
    );
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** Closest pair of points between the boundaries of two disjoint convex polygons. */
function closestPolygonPair(pa: Polygon, pb: Polygon): [Point, Point] {
  let best: [Point, Point] = [
    [pa[0]?.[0] ?? 0, pa[0]?.[1] ?? 0],
    [pb[0]?.[0] ?? 0, pb[0]?.[1] ?? 0],
  ];
  let bestD = Infinity;
  // For disjoint convex polygons the closest pair always includes a vertex of one of them.
  for (const [from, to, flip] of [
    [pa, pb, false],
    [pb, pa, true],
  ] as const) {
    for (const v of from) {
      const q = closestOnBoundary(v, to);
      const d = (q[0] - v[0]) ** 2 + (q[1] - v[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        const p: Point = [v[0], v[1]];
        best = flip ? [q, p] : [p, q];
      }
    }
  }
  return best;
}

/** Point on the outline of `fp` (circle, or its outer polygon) in direction (ux, uy). */
function outlineInDirection(fp: Footprint, ux: number, uy: number): Point {
  if (fp.kind === 'circle') return [fp.cx + fp.r * ux, fp.cy + fp.r * uy];
  // The outer polygon is convex around its centre: the ray leaves it at the nearest edge line.
  const poly = localPolygon(fp);
  let t = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as ReadonlyPoint;
    const q = poly[(i + 1) % poly.length] as ReadonlyPoint;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const denom = ux * ey - uy * ex;
    if (denom === 0) continue;
    const ti = (p[0] * ey - p[1] * ex) / denom;
    if (ti > 0 && ti < t) t = ti;
  }
  if (!Number.isFinite(t)) t = 0;
  return [fp.cx + t * ux, fp.cy + t * uy];
}

/**
 * Closest points between two bases and their edge-to-edge distance (ADR 0025), for the
 * measuring tool. Consistent with {@link footprintGap}: `gap` is its value exactly, and the
 * points are measured on the same shapes (exact for circles, the outer polygon of ellipses
 * and rectangles), so `distance(a, b)` equals `gap` to float rounding. A circle of radius 0
 * is a free point (its point is the centre).
 *
 * Touching or overlapping bases: `gap` is 0, never negative. When they only touch, the points
 * are the contact points (as above); when they overlap (or a free point lies inside a base),
 * `a` and `b` are where the centre-to-centre line leaves each outline towards the other base
 * (along +x when the centres coincide), so the points may cross over.
 */
export function footprintClosestPoints(a: Footprint, b: Footprint): FootprintClosestPoints {
  if (a.kind === 'polygon' || b.kind === 'polygon') {
    // Closest vertex-to-boundary pair (exact for polygons; circles use their outer polygon).
    const pa = outlineOf(a);
    const pb = outlineOf(b);
    const gap = outlineGap(a, b);
    let best: [Point, Point] = [
      [a.cx, a.cy],
      [b.cx, b.cy],
    ];
    let bestD = Infinity;
    for (const [from, to, flip] of [
      [pa, pb, false],
      [pb, pa, true],
    ] as const) {
      for (const v of from) {
        const q = closestOnBoundary(v, to);
        const d = (q[0] - v[0]) ** 2 + (q[1] - v[1]) ** 2;
        if (d < bestD) {
          bestD = d;
          const p: Point = [v[0], v[1]];
          best = flip ? [q, p] : [p, q];
        }
      }
    }
    return { gap, a: best[0], b: best[1] };
  }
  const gap = footprintGap(a, b);
  if (gap <= 0 && (footprintsOverlap(a, b) || centreInside(a, b) || centreInside(b, a))) {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const d = Math.hypot(dx, dy);
    const ux = d === 0 ? 1 : dx / d;
    const uy = d === 0 ? 0 : dy / d;
    return { gap, a: outlineInDirection(a, ux, uy), b: outlineInDirection(b, -ux, -uy) };
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const d = Math.hypot(dx, dy);
    const ux = d === 0 ? 1 : dx / d;
    const uy = d === 0 ? 0 : dy / d;
    return {
      gap,
      a: [a.cx + a.r * ux, a.cy + a.r * uy],
      b: [b.cx - b.r * ux, b.cy - b.r * uy],
    };
  }
  if (a.kind === 'circle') {
    const [pb, pa] = circleToPolygonPoints(a, b);
    return { gap, a: pa, b: pb };
  }
  if (b.kind === 'circle') {
    const [pa, pb] = circleToPolygonPoints(b, a);
    return { gap, a: pa, b: pb };
  }
  const [pa, pb] = closestPolygonPair(footprintPolygon(a), footprintPolygon(b));
  return { gap, a: pa, b: pb };
}

/**
 * A circle whose centre lies in the other (non-circle) base. Only matters for a radius-0
 * circle (a free point), which `footprintsOverlap` does not count as overlapping.
 */
function centreInside(c: Footprint, other: Footprint): boolean {
  return (
    c.kind === 'circle' &&
    other.kind !== 'circle' &&
    pointInPolygon([c.cx, c.cy], footprintPolygon(other))
  );
}

/** Closest points between circle `c` and the outer polygon of `other`: [on other, on c]. */
function circleToPolygonPoints(
  c: Footprint & { kind: 'circle' },
  other: Footprint,
): [Point, Point] {
  const q = closestOnBoundary([c.cx, c.cy], footprintPolygon(other));
  const dx = q[0] - c.cx;
  const dy = q[1] - c.cy;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [q, [c.cx, c.cy]];
  return [q, [c.cx + (c.r * dx) / d, c.cy + (c.r * dy) / d]];
}

/**
 * `footprintGap(a, b) >= threshold`, decided from bounding and inscribed circles when
 * possible so that the polygon distance is rarely needed.
 */
export function footprintGapAtLeast(a: Footprint, b: Footprint, threshold: number): boolean {
  if (a.kind === 'polygon' || b.kind === 'polygon') {
    const d0 = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    if (d0 - outerRadius(a) - outerRadius(b) >= threshold) return true;
    return outlineGap(a, b) >= threshold;
  }
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  if (a.kind === 'circle' && b.kind === 'circle') return Math.max(0, d - a.r - b.r) >= threshold;
  if (d - outerRadius(a) - outerRadius(b) >= threshold) return true;
  if (Math.max(0, d - innerRadius(a) - innerRadius(b)) < threshold) return false;
  return footprintGap(a, b) >= threshold;
}

/**
 * Edge-to-edge gap used for COHERENCY. Exact for two circles; otherwise measured between
 * inner polygons (vertices on the true outline), so it is never smaller than the true gap
 * and at most ~0.002" larger for the biggest bases. Overlap, zone, enemy-distance and
 * terrain checks keep using the outer polygons.
 */
export function footprintCoherencyGap(a: Footprint, b: Footprint): number {
  if (a.kind === 'polygon' || b.kind === 'polygon') return outlineGap(a, b);
  if (a.kind === 'circle' && b.kind === 'circle') {
    return Math.max(0, Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r);
  }
  if (a.kind === 'circle') return Math.max(0, centreToInner(a, b) - a.r);
  if (b.kind === 'circle') return Math.max(0, centreToInner(b, a) - b.r);
  return convexDistanceOffset(innerLocalPolygon(a), innerLocalPolygon(b), a.cx - b.cx, a.cy - b.cy);
}

function centreToInner(c: Footprint, other: Footprint): number {
  return convexDistanceOffset(ORIGIN, innerLocalPolygon(other), c.cx - other.cx, c.cy - other.cy);
}

/** True when two bases are within `range` inches for coherency (see footprintCoherencyGap). */
export function withinCoherencyRange(a: Footprint, b: Footprint, range: number): boolean {
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  // The true shapes lie inside their bounding circles, so this lower bound is safe.
  if (d - boundingRadiusOf(a) - boundingRadiusOf(b) > range + EPS) return false;
  return footprintCoherencyGap(a, b) <= range + EPS;
}

function boundingRadiusOf(fp: Footprint): number {
  if (fp.kind === 'polygon') return boundingRadius(fp);
  return fp.kind === 'circle'
    ? fp.r
    : fp.kind === 'ellipse'
      ? Math.max(fp.rx, fp.ry)
      : Math.hypot(fp.hw, fp.hh);
}

/** Outline used for concave-safe tests: the authored outline, or the base's outer polygon. */
function outlineOf(fp: Footprint): Polygon {
  return fp.kind === 'polygon' ? fp.outline : footprintPolygon(fp);
}

/** True when circle `c` shares area with the (possibly concave) region `poly`. */
function circleOverlapsOutline(c: Footprint & { kind: 'circle' }, poly: Polygon): boolean {
  const p: ReadonlyPoint = [c.cx, c.cy];
  return pointInPolygon(p, poly) || distancePointToBoundary(p, poly) < c.r - EPS;
}

/** Edge gap when either footprint is an authored (possibly concave) outline. */
function outlineGap(a: Footprint, b: Footprint): number {
  if (a.kind === 'circle' || b.kind === 'circle') {
    const c = (a.kind === 'circle' ? a : b) as Footprint & { kind: 'circle' };
    const poly = outlineOf(a.kind === 'circle' ? b : a);
    const p: ReadonlyPoint = [c.cx, c.cy];
    if (pointInPolygon(p, poly)) return 0;
    return Math.max(0, distancePointToBoundary(p, poly) - c.r);
  }
  return polygonDistance(outlineOf(a), outlineOf(b));
}
