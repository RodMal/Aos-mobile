/** The measuring tool: shortest distance between two things on the table, in inches. */
import { footprintClosestPoints, type FootprintClosestPoints } from './geometry.js';
import type { Footprint } from './footprint.js';

/** A free point on the table as a zero-radius base, so it measures like any other footprint. */
export function pointFootprint(x: number, y: number): Footprint {
  return { kind: 'circle', cx: x, cy: y, r: 0 };
}

/**
 * Shortest edge-to-edge distance between two groups of bases (a unit is a group; a point is a
 * group of one zero-radius base), with the closest point on each. `gap` is 0 on touching or
 * overlapping bases. Returns null when either group is empty.
 */
export function measureGroups(
  a: readonly Footprint[],
  b: readonly Footprint[],
): FootprintClosestPoints | null {
  let best: FootprintClosestPoints | null = null;
  for (const fa of a) {
    for (const fb of b) {
      const r = footprintClosestPoints(fa, fb);
      if (!best || r.gap < best.gap) best = r;
    }
  }
  return best;
}
