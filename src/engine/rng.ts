/**
 * Seeded mulberry32 PRNG (ADR 0013/0014). The whole generator state is one uint32, so it can
 * live in the serialisable DeploymentState. All functions are pure: they take a state and
 * return the value plus the next state.
 */

/** Generator state (an unsigned 32-bit integer). */
export type RngState = number;

/** Initial state for a seed (any finite number; it is folded to uint32). */
export function rngFromSeed(seed: number): RngState {
  return Math.trunc(seed) >>> 0;
}

/** Next float in [0, 1) and the next state. */
export function rngNext(state: RngState): { value: number; state: RngState } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s };
}

/** Integer in [min, max] (inclusive) and the next state. */
export function rngInt(
  state: RngState,
  min: number,
  max: number,
): { value: number; state: RngState } {
  const r = rngNext(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
}

/**
 * Small mutable cursor over the pure generator, for code that draws many numbers in a row.
 * Read `state` at the end to store it back.
 */
export class RngCursor {
  constructor(public state: RngState) {}

  next(): number {
    const r = rngNext(this.state);
    this.state = r.state;
    return r.value;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}
