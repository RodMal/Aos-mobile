/** Touch hit testing in table space: which bases are under (or near) a finger. */
import type { Footprint } from '../../geom/index.js';
import type { Pt } from './view.js';

/** Distance in inches from `p` to the edge of a base; 0 when `p` is on or inside it. */
export function distanceToFootprint(fp: Footprint, p: Pt): number {
  const dx = p.x - fp.cx;
  const dy = p.y - fp.cy;
  if (fp.kind === 'circle') return Math.max(0, Math.hypot(dx, dy) - fp.r);
  const t = (-fp.rotation * Math.PI) / 180;
  const lx = dx * Math.cos(t) - dy * Math.sin(t);
  const ly = dx * Math.sin(t) + dy * Math.cos(t);
  if (fp.kind === 'rect') {
    return Math.hypot(Math.max(0, Math.abs(lx) - fp.hw), Math.max(0, Math.abs(ly) - fp.hh));
  }
  const k = Math.hypot(lx / fp.rx, ly / fp.ry);
  if (k <= 1) return 0;
  // Radial approximation: exact on the axes, close enough for picking elsewhere.
  return Math.hypot(lx, ly) * (1 - 1 / k);
}

export interface HitTarget<K> {
  key: K;
  footprints: readonly Footprint[];
}

export interface Hit<K> {
  key: K;
  /** Inches from the point to the nearest base of this target (0 when inside one). */
  distance: number;
}

/** Targets with a base within `slop` inches of `p`, nearest first. */
export function hitTest<K>(targets: readonly HitTarget<K>[], p: Pt, slop: number): Hit<K>[] {
  const hits: Hit<K>[] = [];
  for (const t of targets) {
    let best = Infinity;
    for (const fp of t.footprints) best = Math.min(best, distanceToFootprint(fp, p));
    if (best <= slop) hits.push({ key: t.key, distance: best });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

export type PickResult<K> = { t: 'none' } | { t: 'one'; key: K } | { t: 'choose'; keys: K[] };

/**
 * What a tap means: nothing, one target, or several to choose between. A tap squarely
 * inside exactly one target's base picks it even when others are within the slop.
 */
export function pick<K>(hits: readonly Hit<K>[]): PickResult<K> {
  if (hits.length === 0) return { t: 'none' };
  if (hits.length === 1) return { t: 'one', key: hits[0]!.key };
  const inside = hits.filter((h) => h.distance === 0);
  if (inside.length === 1) return { t: 'one', key: inside[0]!.key };
  return { t: 'choose', keys: hits.map((h) => h.key) };
}
