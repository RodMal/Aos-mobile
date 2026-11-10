/**
 * The board's view transform: table inches <-> screen pixels.
 *
 * screen = scale * R(rot) * table + (tx, ty)
 *
 * `rot` turns the 60" x 44" table so its long axis runs down a portrait screen. With
 * `rot = -90` the table's left edge (x = 0) is at the bottom of the screen; with `rot = 90`
 * its right edge (x = 60) is. Pure maths, no DOM.
 */

export type Rot = 0 | 90 | -90;

export interface View {
  /** Screen pixels per inch. */
  scale: number;
  tx: number;
  ty: number;
  rot: Rot;
}

export interface Pt {
  x: number;
  y: number;
}

/** The board element's size, and the parts of it covered by chrome (top bar, bottom sheet). */
export interface Viewport {
  w: number;
  h: number;
  insetTop: number;
  insetBottom: number;
}

export interface TableSize {
  w: number;
  h: number;
}

export interface ZoomLimits {
  /** Smallest scale as a fraction of the fit-to-screen scale. */
  minFitFraction: number;
  /** Largest scale in pixels per inch. */
  maxScale: number;
}

export const DEFAULT_LIMITS: ZoomLimits = { minFitFraction: 0.85, maxScale: 160 };

/** Rotates a table vector into screen orientation (no scale). */
export function rotate(rot: Rot, p: Pt): Pt {
  if (rot === 90) return { x: -p.y, y: p.x };
  if (rot === -90) return { x: p.y, y: -p.x };
  return { x: p.x, y: p.y };
}

/** Inverse of {@link rotate}. */
export function unrotate(rot: Rot, p: Pt): Pt {
  if (rot === 90) return { x: p.y, y: -p.x };
  if (rot === -90) return { x: -p.y, y: p.x };
  return { x: p.x, y: p.y };
}

export function tableToScreen(v: View, p: Pt): Pt {
  const r = rotate(v.rot, p);
  return { x: v.scale * r.x + v.tx, y: v.scale * r.y + v.ty };
}

export function screenToTable(v: View, p: Pt): Pt {
  return unrotate(v.rot, { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });
}

/** A screen-space displacement as a table-space displacement in inches. */
export function screenDeltaToTable(v: View, d: Pt): Pt {
  return unrotate(v.rot, { x: d.x / v.scale, y: d.y / v.scale });
}

/** Screen pixels as inches at the current zoom. */
export function pxToInches(v: View, px: number): number {
  return px / v.scale;
}

/** SVG `matrix(a b c d e f)` arguments for the view. */
export function svgMatrix(v: View): [number, number, number, number, number, number] {
  const s = v.scale;
  if (v.rot === 90) return [0, s, -s, 0, v.tx, v.ty];
  if (v.rot === -90) return [0, -s, s, 0, v.tx, v.ty];
  return [s, 0, 0, s, v.tx, v.ty];
}

export function svgTransform(v: View): string {
  return `matrix(${svgMatrix(v)
    .map((n) => +n.toFixed(4))
    .join(' ')})`;
}

/** Size of the table on screen at scale 1 after rotation. */
function rotatedSize(table: TableSize, rot: Rot): TableSize {
  return rot === 0 ? table : { w: table.h, h: table.w };
}

function visibleHeight(vp: Viewport): number {
  return Math.max(1, vp.h - vp.insetTop - vp.insetBottom);
}

/** The scale at which the whole table fits the visible part of the viewport. */
export function fitScale(vp: Viewport, table: TableSize, rot: Rot, pad = 8): number {
  const size = rotatedSize(table, rot);
  return Math.min(
    Math.max(1, vp.w - 2 * pad) / size.w,
    Math.max(1, visibleHeight(vp) - 2 * pad) / size.h,
  );
}

/** Centre of the visible part of the viewport. */
export function visibleCentre(vp: Viewport): Pt {
  return { x: vp.w / 2, y: vp.insetTop + visibleHeight(vp) / 2 };
}

/** A view with table point `p` at the centre of the visible area, at `scale`. */
export function centreOn(v: View, p: Pt, vp: Viewport, scale = v.scale): View {
  const c = visibleCentre(vp);
  const r = rotate(v.rot, p);
  return { ...v, scale, tx: c.x - scale * r.x, ty: c.y - scale * r.y };
}

/** The whole table, centred in the visible area. */
export function fitView(vp: Viewport, table: TableSize, rot: Rot, pad = 8): View {
  const scale = fitScale(vp, table, rot, pad);
  return centreOn({ scale, tx: 0, ty: 0, rot }, { x: table.w / 2, y: table.h / 2 }, vp, scale);
}

/**
 * A view that shows all of `points` (table coordinates) in the visible area, zoomed in as far
 * as fits but never beyond `maxScale`. Used to frame an attacker together with its targets.
 */
export function frameView(
  v: View,
  points: readonly Pt[],
  vp: Viewport,
  maxScale: number,
  pad = 56,
): View {
  if (points.length === 0) return v;
  const rotated = points.map((p) => rotate(v.rot, p));
  const xs = rotated.map((p) => p.x);
  const ys = rotated.map((p) => p.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(
    maxScale,
    Math.max(1, vp.w - 2 * pad) / Math.max(maxX - minX, 1e-6),
    Math.max(1, visibleHeight(vp) - 2 * pad) / Math.max(maxY - minY, 1e-6),
  );
  const c = visibleCentre(vp);
  return {
    ...v,
    scale,
    tx: c.x - (scale * (minX + maxX)) / 2,
    ty: c.y - (scale * (minY + maxY)) / 2,
  };
}

export function clampScale(
  scale: number,
  vp: Viewport,
  table: TableSize,
  rot: Rot,
  limits: ZoomLimits = DEFAULT_LIMITS,
): number {
  const min = fitScale(vp, table, rot) * limits.minFitFraction;
  return Math.min(Math.max(scale, min), Math.max(min, limits.maxScale));
}

/** Zooms by `factor` keeping the table point under `at` (screen) where it is. */
export function zoomAbout(
  v: View,
  factor: number,
  at: Pt,
  vp: Viewport,
  table: TableSize,
  limits: ZoomLimits = DEFAULT_LIMITS,
): View {
  const scale = clampScale(v.scale * factor, vp, table, v.rot, limits);
  const p = screenToTable(v, at);
  const r = rotate(v.rot, p);
  return { ...v, scale, tx: at.x - scale * r.x, ty: at.y - scale * r.y };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, tx: v.tx + dx, ty: v.ty + dy };
}

/**
 * Keeps the table reachable: when it is smaller than the visible area on an axis it stays
 * inside that area; when larger, it cannot be dragged further than `margin` past an edge.
 */
export function clampView(v: View, vp: Viewport, table: TableSize, margin = 48): View {
  const corners = [
    { x: 0, y: 0 },
    { x: table.w, y: 0 },
    { x: 0, y: table.h },
    { x: table.w, y: table.h },
  ].map((p) => tableToScreen(v, p));
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  const top = vp.insetTop;
  const bottom = vp.h - vp.insetBottom;
  const dx = axisShift(minX, maxX, 0, vp.w, margin);
  const dy = axisShift(minY, maxY, top, bottom, margin);
  return dx === 0 && dy === 0 ? v : { ...v, tx: v.tx + dx, ty: v.ty + dy };
}

function axisShift(min: number, max: number, lo: number, hi: number, margin: number): number {
  const size = max - min;
  if (size <= hi - lo) {
    if (min < lo) return lo - min;
    if (max > hi) return hi - max;
    return 0;
  }
  if (min > lo + margin) return lo + margin - min;
  if (max < hi - margin) return hi - margin - max;
  return 0;
}

/** Linear interpolation between two views, for short camera animations. */
export function lerpView(a: View, b: View, t: number): View {
  return {
    rot: b.rot,
    scale: a.scale + (b.scale - a.scale) * t,
    tx: a.tx + (b.tx - a.tx) * t,
    ty: a.ty + (b.ty - a.ty) * t,
  };
}

/** True when table point `p` is inside the visible area (with `pad` pixels to spare). */
export function isVisible(v: View, p: Pt, vp: Viewport, pad = 40): boolean {
  const s = tableToScreen(v, p);
  return (
    s.x >= pad &&
    s.x <= vp.w - pad &&
    s.y >= vp.insetTop + pad &&
    s.y <= vp.h - vp.insetBottom - pad
  );
}

/** The rotation that puts `player`'s half of the table at the bottom of the screen. */
export function rotationFor(player: 0 | 1): Rot {
  // Player 0 holds the left of the table (small x), player 1 the right.
  return player === 0 ? -90 : 90;
}
