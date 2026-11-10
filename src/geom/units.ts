/** Millimetres per inch; base sizes are in mm, the board and all rules in inches. */
export const MM_PER_INCH = 25.4;

/** Coherency range in AoS 4: within 1/2" (edge to edge, horizontally). */
export const COHERENCY_RANGE_IN = 0.5;

/** Units with this many models or more need 2 coherency neighbours per model. */
export const COHERENCY_TWO_NEIGHBOURS_FROM = 7;

/** Default gap between bases in a formation, in inches. */
export const DEFAULT_FORMATION_GAP_IN = 0.25;

/** Number of edges of the polygon used for ellipse (and mixed-shape) tests. */
export const BASE_POLYGON_SEGMENTS = 24;

/** Numeric tolerance in inches. */
export const EPS = 1e-9;

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

/** Segments of the inscribed polygon used for coherency gaps (see footprint.ts). */
export const COHERENCY_POLYGON_SEGMENTS_FOR_MARGIN = 96;
