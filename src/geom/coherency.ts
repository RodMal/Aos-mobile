import { tokenFootprint, type Footprint, type Token } from './footprint.js';
import { withinCoherencyRange } from './geometry.js';
import { COHERENCY_RANGE_IN, COHERENCY_TWO_NEIGHBOURS_FROM } from './units.js';

export interface CoherencyResult {
  coherent: boolean;
  /** Neighbours each model needs: 1, or 2 for units of 7+ models (0 for a single model). */
  required: number;
  /** Array indices of models with fewer neighbours than required. */
  lacking: number[];
  /** Number of connected groups (coherent units form exactly 1). */
  groups: number;
}

/**
 * AoS 4 coherency: every model within 1/2" of at least one other model of its unit (two
 * others for units of 7+ models), and the unit forms a single group. Gaps are measured so
 * that a true gap above 1/2" is never accepted (see footprintCoherencyGap).
 */
export function checkCoherencyFootprints(fps: readonly Footprint[]): CoherencyResult {
  const n = fps.length;
  const required = n <= 1 ? 0 : n >= COHERENCY_TWO_NEIGHBOURS_FROM ? 2 : 1;
  const adj: number[][] = fps.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (withinCoherencyRange(fps[i] as Footprint, fps[j] as Footprint, COHERENCY_RANGE_IN)) {
        (adj[i] as number[]).push(j);
        (adj[j] as number[]).push(i);
      }
    }
  }
  const lacking = adj.flatMap((a, i) => (a.length < required ? [i] : []));
  const seen = new Array<boolean>(n).fill(false);
  let groups = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    groups++;
    const stack = [s];
    seen[s] = true;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      for (const j of adj[i] as number[]) {
        if (!seen[j]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
  }
  return { coherent: lacking.length === 0 && groups <= 1, required, lacking, groups };
}

export function checkCoherency(tokens: readonly Token[]): CoherencyResult {
  return checkCoherencyFootprints(tokens.map(tokenFootprint));
}
