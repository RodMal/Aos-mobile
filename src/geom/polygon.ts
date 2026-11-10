/**
 * Plane geometry primitives shared by the map schema refinements and `@aos/deployment`.
 * Everything is in inches in the board frame of ADR 0011: origin top-left, x right, y down.
 * Pure TypeScript, browser-safe, no allocation-heavy dependencies.
 */

/** `[x, y]` in inches. */
export type Point = [x: number, y: number];
export type ReadonlyPoint = readonly [x: number, y: number];
/** A simple polygon, closed implicitly; clockwise or counter-clockwise. */
export type Polygon = readonly ReadonlyPoint[];

/** Tolerance (inches) for "on the boundary" and collinearity tests. */
export const GEOMETRY_EPS = 1e-9;

/** Default number of segments used to turn a map circle into a polygon. */
export const MAP_CIRCLE_SEGMENTS = 48;

export type MapShape =
  | { type: 'polygon'; points: readonly ReadonlyPoint[] }
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'circle'; cx: number; cy: number; r: number };

/** `(a - o) x (b - o)`; positive when o→a→b turns clockwise on screen (y down). */
export function cross(o: ReadonlyPoint, a: ReadonlyPoint, b: ReadonlyPoint): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function distance(a: ReadonlyPoint, b: ReadonlyPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Signed shoelace area; the sign depends on the winding. */
export function polygonSignedArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as ReadonlyPoint;
    const b = poly[(i + 1) % poly.length] as ReadonlyPoint;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function polygonArea(poly: Polygon): number {
  return Math.abs(polygonSignedArea(poly));
}

export function distancePointToSegment(
  p: ReadonlyPoint,
  a: ReadonlyPoint,
  b: ReadonlyPoint,
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Smallest distance from `p` to any edge of `poly` (0 when `p` is on an edge). */
export function distancePointToBoundary(p: ReadonlyPoint, poly: Polygon): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distancePointToSegment(
      p,
      poly[i] as ReadonlyPoint,
      poly[(i + 1) % poly.length] as ReadonlyPoint,
    );
    if (d < best) best = d;
  }
  return best;
}

function orientation(a: ReadonlyPoint, b: ReadonlyPoint, c: ReadonlyPoint, eps: number): number {
  const v = cross(a, b, c);
  // Scale the tolerance with the edge length so it is a distance, not an area.
  const tol = eps * Math.max(1, distance(a, b));
  if (v > tol) return 1;
  if (v < -tol) return -1;
  return 0;
}

/** True when the segments share at least one point (touching counts). */
export function segmentsIntersect(
  a: ReadonlyPoint,
  b: ReadonlyPoint,
  c: ReadonlyPoint,
  d: ReadonlyPoint,
  eps = GEOMETRY_EPS,
): boolean {
  if (segmentsProperlyCross(a, b, c, d, eps)) return true;
  return (
    distancePointToSegment(c, a, b) <= eps ||
    distancePointToSegment(d, a, b) <= eps ||
    distancePointToSegment(a, c, d) <= eps ||
    distancePointToSegment(b, c, d) <= eps
  );
}

/** True when the segments cross at a single interior point of both (touching excluded). */
export function segmentsProperlyCross(
  a: ReadonlyPoint,
  b: ReadonlyPoint,
  c: ReadonlyPoint,
  d: ReadonlyPoint,
  eps = GEOMETRY_EPS,
): boolean {
  const o1 = orientation(a, b, c, eps);
  const o2 = orientation(a, b, d, eps);
  const o3 = orientation(c, d, a, eps);
  const o4 = orientation(c, d, b, eps);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export type PointLocation = 'inside' | 'outside' | 'boundary';

/** Where `p` lies relative to `poly`: ray casting (even-odd) plus an explicit boundary test. */
export function pointLocation(p: ReadonlyPoint, poly: Polygon, eps = GEOMETRY_EPS): PointLocation {
  if (distancePointToBoundary(p, poly) <= eps) return 'boundary';
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as ReadonlyPoint;
    const b = poly[j] as ReadonlyPoint;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (p[0] < x) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

/** Closed point-in-polygon: true inside or on the boundary. Works for concave polygons. */
export function pointInPolygon(p: ReadonlyPoint, poly: Polygon, eps = GEOMETRY_EPS): boolean {
  return pointLocation(p, poly, eps) !== 'outside';
}

/** Open point-in-polygon: true only strictly inside (more than `eps` from every edge). */
export function pointStrictlyInPolygon(
  p: ReadonlyPoint,
  poly: Polygon,
  eps = GEOMETRY_EPS,
): boolean {
  return pointLocation(p, poly, eps) === 'inside';
}

/**
 * Parameters `t` in [0, 1] along segment p→q where it meets the edges or vertices of `poly`,
 * always including 0 and 1, sorted and de-duplicated. Between two consecutive parameters the
 * segment is wholly inside or wholly outside `poly`.
 */
function splitParameters(p: ReadonlyPoint, q: ReadonlyPoint, poly: Polygon): number[] {
  const ts = [0, 1];
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const len2 = rx * rx + ry * ry;
  if (len2 === 0) return ts;
  const project = (v: ReadonlyPoint): number => ((v[0] - p[0]) * rx + (v[1] - p[1]) * ry) / len2;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as ReadonlyPoint;
    const b = poly[(i + 1) % poly.length] as ReadonlyPoint;
    if (distancePointToSegment(a, p, q) <= GEOMETRY_EPS) ts.push(project(a));
    const sx = b[0] - a[0];
    const sy = b[1] - a[1];
    const denom = rx * sy - ry * sx;
    if (denom !== 0) {
      const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / denom;
      const u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / denom;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  return [...new Set(ts.map((t) => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y);
}

/**
 * True when every point of `inner` lies inside or on `outer`. `outer` may be concave (it
 * must be simple). Because a simple polygon has no holes, it is enough to check that the
 * whole boundary of `inner` is inside `outer`: each edge is split where it meets `outer`'s
 * edges and vertices, and the vertices plus the midpoint of every piece are tested.
 */
export function polygonInsidePolygon(inner: Polygon, outer: Polygon, eps = GEOMETRY_EPS): boolean {
  for (const v of inner) {
    if (!pointInPolygon(v, outer, eps)) return false;
  }
  for (let i = 0; i < inner.length; i++) {
    const p = inner[i] as ReadonlyPoint;
    const q = inner[(i + 1) % inner.length] as ReadonlyPoint;
    const ts = splitParameters(p, q, outer);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t = ((ts[k] as number) + (ts[k + 1] as number)) / 2;
      const m: ReadonlyPoint = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      if (!pointInPolygon(m, outer, eps)) return false;
    }
  }
  return true;
}

/**
 * True when the interiors of `a` and `b` share some area (touching edges or vertices only
 * does not count). Both may be concave.
 */
export function polygonsOverlap(a: Polygon, b: Polygon, eps = GEOMETRY_EPS): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as ReadonlyPoint;
    const q = a[(i + 1) % a.length] as ReadonlyPoint;
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsProperlyCross(
          p,
          q,
          b[j] as ReadonlyPoint,
          b[(j + 1) % b.length] as ReadonlyPoint,
          eps,
        )
      )
        return true;
    }
  }
  const anyPieceInside = (x: Polygon, y: Polygon): boolean => {
    for (let i = 0; i < x.length; i++) {
      const p = x[i] as ReadonlyPoint;
      if (pointStrictlyInPolygon(p, y, eps)) return true;
      const q = x[(i + 1) % x.length] as ReadonlyPoint;
      const ts = splitParameters(p, q, y);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t = ((ts[k] as number) + (ts[k + 1] as number)) / 2;
        if (pointStrictlyInPolygon([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], y, eps))
          return true;
      }
    }
    return false;
  };
  if (anyPieceInside(a, b) || anyPieceInside(b, a)) return true;
  // Identical or boundary-coincident polygons: compare an interior sample point.
  const c = interiorPoint(a);
  return c !== undefined && pointStrictlyInPolygon(c, b, eps);
}

/** A point strictly inside a simple polygon (centroid of an ear), or undefined if degenerate. */
export function interiorPoint(poly: Polygon): ReadonlyPoint | undefined {
  const n = poly.length;
  const sign = Math.sign(polygonSignedArea(poly));
  if (n < 3 || sign === 0) return undefined;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n] as ReadonlyPoint;
    const b = poly[i] as ReadonlyPoint;
    const c = poly[(i + 1) % n] as ReadonlyPoint;
    if (Math.sign(cross(a, b, c)) !== sign) continue;
    const g: ReadonlyPoint = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    if (pointStrictlyInPolygon(g, poly)) return g;
  }
  return undefined;
}

/**
 * Smallest distance between two polygon regions; 0 when they touch or overlap. Both may be
 * concave.
 */
export function polygonDistance(a: Polygon, b: Polygon, eps = GEOMETRY_EPS): number {
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as ReadonlyPoint;
    const q = a[(i + 1) % a.length] as ReadonlyPoint;
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsIntersect(p, q, b[j] as ReadonlyPoint, b[(j + 1) % b.length] as ReadonlyPoint, eps)
      )
        return 0;
    }
  }
  const first = a[0];
  const firstB = b[0];
  if (first !== undefined && pointInPolygon(first, b, eps)) return 0;
  if (firstB !== undefined && pointInPolygon(firstB, a, eps)) return 0;
  let best = Infinity;
  for (const v of a) best = Math.min(best, distancePointToBoundary(v, b));
  for (const v of b) best = Math.min(best, distancePointToBoundary(v, a));
  return best;
}

/** Problems that make a polygon unusable, as human-readable strings (empty = valid). */
export function polygonProblems(poly: Polygon, eps = GEOMETRY_EPS): string[] {
  const problems: string[] = [];
  const n = poly.length;
  if (n < 3) return [`needs at least 3 points, got ${n}`];
  for (let i = 0; i < n; i++) {
    const a = poly[i] as ReadonlyPoint;
    const b = poly[(i + 1) % n] as ReadonlyPoint;
    if (distance(a, b) <= eps) problems.push(`points ${i} and ${(i + 1) % n} are the same`);
  }
  if (problems.length > 0) return problems;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as ReadonlyPoint;
    const b = poly[(i + 1) % n] as ReadonlyPoint;
    for (let j = i + 1; j < n; j++) {
      const c = poly[j] as ReadonlyPoint;
      const d = poly[(j + 1) % n] as ReadonlyPoint;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Adjacent edges share one vertex; they must not fold back onto each other.
        const shared = j === i + 1 ? b : a;
        const other1 = j === i + 1 ? a : b;
        const other2 = j === i + 1 ? d : c;
        const u: ReadonlyPoint = [other1[0] - shared[0], other1[1] - shared[1]];
        const v: ReadonlyPoint = [other2[0] - shared[0], other2[1] - shared[1]];
        const crossUV = u[0] * v[1] - u[1] * v[0];
        const dot = u[0] * v[0] + u[1] * v[1];
        if (Math.abs(crossUV) <= eps * Math.hypot(...u) * Math.hypot(...v) && dot > 0)
          problems.push(`edges ${i} and ${j} overlap (spike at a vertex)`);
      } else if (segmentsIntersect(a, b, c, d, eps)) {
        problems.push(`edges ${i} and ${j} intersect (polygon is not simple)`);
      }
    }
  }
  if (problems.length === 0 && polygonArea(poly) <= 1e-6)
    problems.push('is degenerate (zero area)');
  return problems;
}

export type CircleFit = 'inscribed' | 'circumscribed';

/**
 * Regular polygon approximating a circle. `inscribed` puts the vertices on the circle (the
 * polygon lies inside it); `circumscribed` puts the edges tangent to it (the polygon
 * contains it). Vertices go clockwise on screen.
 */
export function circlePolygon(
  cx: number,
  cy: number,
  r: number,
  segments = MAP_CIRCLE_SEGMENTS,
  fit: CircleFit = 'inscribed',
): ReadonlyPoint[] {
  const R = fit === 'circumscribed' ? r / Math.cos(Math.PI / segments) : r;
  // Circumscribed: vertices offset by half a step, so the edges touch the circle at angle 0
  // and (when segments is a multiple of 4) at every axis direction; the polygon's axis
  // extents are then exact. Inscribed: vertices on the axes, also exact extents.
  const offset = fit === 'circumscribed' ? Math.PI / segments : 0;
  const pts: ReadonlyPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments + offset;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return pts;
}

/** Convert a map shape to a polygon (circles are approximated, see {@link circlePolygon}). */
export function shapeToPolygon(
  shape: MapShape,
  opts: { segments?: number; fit?: CircleFit } = {},
): ReadonlyPoint[] {
  switch (shape.type) {
    case 'polygon':
      return shape.points.map((p) => [p[0], p[1]] as const);
    case 'rect':
      return [
        [shape.x, shape.y],
        [shape.x + shape.w, shape.y],
        [shape.x + shape.w, shape.y + shape.h],
        [shape.x, shape.y + shape.h],
      ];
    case 'circle':
      return circlePolygon(shape.cx, shape.cy, shape.r, opts.segments, opts.fit);
  }
}

/**
 * True when shape `inner` lies wholly within shape `outer`. Exact whenever a circle is
 * involved (circle in circle, circle in polygon, polygon in circle); polygons in polygons use
 * {@link polygonInsidePolygon}.
 */
export function shapeInsideShape(inner: MapShape, outer: MapShape, eps = 1e-6): boolean {
  if (inner.type === 'circle') {
    const c: ReadonlyPoint = [inner.cx, inner.cy];
    if (outer.type === 'circle')
      return distance(c, [outer.cx, outer.cy]) + inner.r <= outer.r + eps;
    const poly = shapeToPolygon(outer);
    return pointInPolygon(c, poly, eps) && distancePointToBoundary(c, poly) >= inner.r - eps;
  }
  const pts = shapeToPolygon(inner);
  if (outer.type === 'circle') {
    // A disc is convex: a polygon is inside it iff all its vertices are.
    return pts.every((p) => distance(p, [outer.cx, outer.cy]) <= outer.r + eps);
  }
  return polygonInsidePolygon(pts, shapeToPolygon(outer), eps);
}
