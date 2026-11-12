import { FALLBACK_BASE, type BaseShape } from '../data/schema/index.js';
import { circlePolygon, type ReadonlyPoint } from './polygon.js';
import {
  BASE_POLYGON_SEGMENTS,
  COHERENCY_POLYGON_SEGMENTS_FOR_MARGIN,
  mmToInches,
} from './units.js';

/**
 * A model on the board: its resolved base (ADR 0009) and the base centre in inches.
 * `rotation` is in degrees, clockwise on screen. At rotation 0 an oval's length runs along
 * the x axis (as a Konva Ellipse's radiusX does, ADR 0012).
 */
export interface Token {
  modelIndex: number;
  base: ModelBase;
  x: number;
  y: number;
  rotation: number;
}

/** A base outline in inches, ready for geometry tests. */
export type Footprint =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  /** `rx` is the half-length (local x axis), `ry` the half-width. */
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number }
  /** `hw`/`hh` are half the length (local x) and half the width (local y). */
  | { kind: 'rect'; cx: number; cy: number; hw: number; hh: number; rotation: number }
  /**
   * A piece of faction terrain with an authored, possibly concave outline (the Awakened
   * Wyldwood crescents): `outline` is the polygon in table inches. Every geometry test on
   * it uses the general (concave-safe) polygon routines.
   */
  | {
      kind: 'polygon';
      cx: number;
      cy: number;
      rotation: number;
      outline: readonly ReadonlyPoint[];
    };

/** An authored outline in inches around the model's position (0, 0), at rotation 0. */
export interface OutlineBase {
  kind: 'outline';
  points: readonly (readonly [number, number])[];
  /**
   * A part of the piece models cannot stand on (the Awakened Wyldwood's tree trunk), as a
   * circle in the same local inches as `points`. The rest of the outline may be stood on.
   */
  trunk?: { x: number; y: number; r: number };
}

/** The trunk zone of a base placed at (x, y) with `rotation`, or null when it has none. */
export function trunkFootprint(
  base: ModelBase,
  x: number,
  y: number,
  rotation = 0,
): Footprint | null {
  if (base.kind !== 'outline' || !base.trunk) return null;
  const t = (rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const { x: lx, y: ly, r } = base.trunk;
  return { kind: 'circle', cx: x + lx * c - ly * s, cy: y + lx * s + ly * c, r };
}

/** A model's base: a data base shape, or an authored outline for faction terrain. */
export type ModelBase = BaseShape | OutlineBase;

function outlineFootprint(base: OutlineBase, x: number, y: number, rotation: number): Footprint {
  const t = (rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const outline = base.points.map(
    ([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c] as const,
  );
  return { kind: 'polygon', cx: x, cy: y, rotation, outline };
}

/** Base diameter in inches (32mm → 1.2598"). */
export function baseDiameterIn(diameterMm: number): number {
  return mmToInches(diameterMm);
}

/** Footprint of a base centred at (x, y). `useModel` falls back to the 32mm round base. */
export function baseFootprint(base: ModelBase, x: number, y: number, rotation = 0): Footprint {
  switch (base.kind) {
    case 'outline':
      return outlineFootprint(base, x, y, rotation);
    case 'round':
      return { kind: 'circle', cx: x, cy: y, r: mmToInches(base.diameterMm) / 2 };
    case 'oval':
      return {
        kind: 'ellipse',
        cx: x,
        cy: y,
        rx: mmToInches(base.lengthMm) / 2,
        ry: mmToInches(base.widthMm) / 2,
        rotation,
      };
    case 'rect':
      return {
        kind: 'rect',
        cx: x,
        cy: y,
        hw: mmToInches(base.lengthMm) / 2,
        hh: mmToInches(base.widthMm) / 2,
        rotation,
      };
    case 'useModel':
      return baseFootprint(FALLBACK_BASE, x, y, rotation);
  }
}

export function tokenFootprint(token: Token): Footprint {
  return baseFootprint(token.base, token.x, token.y, token.rotation);
}

/** Same footprint moved so that its centre is (x, y). */
export function moveFootprint(fp: Footprint, x: number, y: number): Footprint {
  if (fp.kind === 'polygon') {
    const dx = x - fp.cx;
    const dy = y - fp.cy;
    return {
      ...fp,
      cx: x,
      cy: y,
      outline: fp.outline.map(([px, py]) => [px + dx, py + dy] as const),
    };
  }
  return { ...fp, cx: x, cy: y };
}

/** Radius of the smallest circle around the centre that contains the footprint. */
/** Bounding radii of polygon outlines, computed once per outline array (pure memo). */
const outlineRadius = new WeakMap<object, number>();

export function boundingRadius(fp: Footprint): number {
  switch (fp.kind) {
    case 'circle':
      return fp.r;
    case 'ellipse':
      return Math.max(fp.rx, fp.ry);
    case 'rect':
      return Math.hypot(fp.hw, fp.hh);
    case 'polygon': {
      const hit = outlineRadius.get(fp.outline);
      if (hit !== undefined) return hit;
      let r = 0;
      for (const [x, y] of fp.outline) r = Math.max(r, Math.hypot(x - fp.cx, y - fp.cy));
      outlineRadius.set(fp.outline, r);
      return r;
    }
  }
}

/** Half extents of the footprint's axis-aligned bounding box. */
export function halfExtents(fp: Footprint): { hx: number; hy: number } {
  if (fp.kind === 'circle') return { hx: fp.r, hy: fp.r };
  if (fp.kind === 'polygon') {
    return {
      hx: Math.max(...fp.outline.map(([x]) => Math.abs(x - fp.cx))),
      hy: Math.max(...fp.outline.map(([, y]) => Math.abs(y - fp.cy))),
    };
  }
  const t = (fp.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  if (fp.kind === 'ellipse') {
    return {
      hx: Math.sqrt(fp.rx * fp.rx * c * c + fp.ry * fp.ry * s * s),
      hy: Math.sqrt(fp.rx * fp.rx * s * s + fp.ry * fp.ry * c * c),
    };
  }
  return { hx: fp.hw * c + fp.hh * s, hy: fp.hw * s + fp.hh * c };
}

const localPolygonCache = new Map<string, readonly ReadonlyPoint[]>();

/** Outer polygon of the footprint relative to its centre, cached by shape and rotation. */
export function localPolygon(
  fp: Footprint,
  segments = BASE_POLYGON_SEGMENTS,
): readonly ReadonlyPoint[] {
  // May be concave: geometry routes these through the general polygon routines.
  if (fp.kind === 'polygon') return fp.outline.map(([x, y]) => [x - fp.cx, y - fp.cy] as const);
  const key =
    fp.kind === 'circle'
      ? `c|${fp.r}|${segments}`
      : fp.kind === 'ellipse'
        ? `e|${fp.rx}|${fp.ry}|${fp.rotation}|${segments}`
        : `r|${fp.hw}|${fp.hh}|${fp.rotation}`;
  const hit = localPolygonCache.get(key);
  if (hit) return hit;
  let pts: ReadonlyPoint[];
  if (fp.kind === 'circle') {
    pts = circlePolygon(0, 0, fp.r, segments, 'circumscribed');
  } else {
    const unit =
      fp.kind === 'ellipse'
        ? circlePolygon(0, 0, 1, segments, 'circumscribed').map(
            ([x, y]) => [x * fp.rx, y * fp.ry] as const,
          )
        : ([
            [-fp.hw, -fp.hh],
            [fp.hw, -fp.hh],
            [fp.hw, fp.hh],
            [-fp.hw, fp.hh],
          ] as const);
    const t = (fp.rotation * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts = unit.map(([x, y]) => [x * c - y * s, x * s + y * c] as const);
  }
  if (localPolygonCache.size > 4096) localPolygonCache.clear();
  localPolygonCache.set(key, pts);
  return pts;
}

/** Segments of the inscribed polygon used to measure coherency gaps. */
export const COHERENCY_POLYGON_SEGMENTS = COHERENCY_POLYGON_SEGMENTS_FOR_MARGIN;

const innerPolygonCache = new Map<string, readonly ReadonlyPoint[]>();

/**
 * Polygon INSIDE the footprint, relative to its centre: vertices on the ellipse
 * (96 segments, so it is at most 0.06% of the radius inside the true outline) or the exact
 * rectangle. Gaps measured between inner polygons are never smaller than the true gap, so
 * coherency ("within 1/2"") can only be judged strictly. Circles never need it: they are
 * measured exactly.
 */
export function innerLocalPolygon(fp: Footprint): readonly ReadonlyPoint[] {
  if (fp.kind === 'rect' || fp.kind === 'polygon') return localPolygon(fp);
  const rx = fp.kind === 'circle' ? fp.r : fp.rx;
  const ry = fp.kind === 'circle' ? fp.r : fp.ry;
  const rotation = fp.kind === 'circle' ? 0 : fp.rotation;
  const key = `${rx}|${ry}|${rotation}`;
  const hit = innerPolygonCache.get(key);
  if (hit) return hit;
  const t = (rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const pts = circlePolygon(0, 0, 1, COHERENCY_POLYGON_SEGMENTS, 'inscribed').map(([x, y]) => {
    const lx = x * rx;
    const ly = y * ry;
    return [lx * c - ly * s, lx * s + ly * c] as const;
  });
  if (innerPolygonCache.size > 4096) innerPolygonCache.clear();
  innerPolygonCache.set(key, pts);
  return pts;
}

const polygonCache = new WeakMap<Footprint, ReadonlyPoint[]>();

/**
 * Convex polygon that CONTAINS the footprint: a circumscribed 24-gon for circles and
 * ellipses (the affine image of a circumscribed regular polygon contains the ellipse), the
 * exact corners for rectangles. Using an outer polygon keeps every test conservative:
 * containment and distance-from-enemy checks can only reject more, never accept an overlap.
 */
export function footprintPolygon(fp: Footprint, segments = BASE_POLYGON_SEGMENTS): ReadonlyPoint[] {
  const cache = segments === BASE_POLYGON_SEGMENTS;
  const cached = cache ? polygonCache.get(fp) : undefined;
  if (cached) return cached;
  if (fp.kind === 'polygon') return [...fp.outline];
  const pts = localPolygon(fp, segments).map(([x, y]) => [fp.cx + x, fp.cy + y] as const);
  if (cache) polygonCache.set(fp, pts);
  return pts;
}
