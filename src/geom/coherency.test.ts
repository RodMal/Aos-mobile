import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  baseFootprint,
  checkCoherency,
  footprintCoherencyGap,
  withinCoherencyRange,
  type Token,
} from './index.js';
import { outlinePoints, oval, round } from './test-helpers.js';

const D = 32 / 25.4;
/** A straight line of 32mm bases with the given edge-to-edge gaps. */
function line(gaps: number[]): Token[] {
  const tokens: Token[] = [{ modelIndex: 0, base: round(32), x: 0, y: 0, rotation: 0 }];
  let x = 0;
  gaps.forEach((g, i) => {
    x += D + g;
    tokens.push({ modelIndex: i + 1, base: round(32), x, y: 0, rotation: 0 });
  });
  return tokens;
}

describe('coherency (AoS 4)', () => {
  it('a single model is always coherent', () => {
    expect(checkCoherency(line([])).coherent).toBe(true);
  });

  it('exactly 1/2" apart is coherent; a bit more is not', () => {
    expect(checkCoherency(line([0.5])).coherent).toBe(true);
    const r = checkCoherency(line([0.51]));
    expect(r.coherent).toBe(false);
    expect(r.lacking).toEqual([0, 1]);
  });

  it('a line of 6 is coherent but a line of 7 is not: its ends have only one neighbour', () => {
    expect(checkCoherency(line([0.25, 0.25, 0.25, 0.25, 0.25])).coherent).toBe(true);
    const seven = checkCoherency(line([0.25, 0.25, 0.25, 0.25, 0.25, 0.25]));
    expect(seven).toMatchObject({ coherent: false, required: 2, lacking: [0, 6], groups: 1 });
  });

  it('a unit split into two groups is not coherent even if every model has a neighbour', () => {
    const r = checkCoherency(line([0.25, 3, 0.25]));
    expect(r).toMatchObject({ coherent: false, lacking: [], groups: 2 });
  });
});

describe('coherency is measured on the true outline, not the outer polygon', () => {
  const big = oval(170, 105); // half-length 3.346", half-width 2.067"
  const hl = 85 / 25.4;
  const hw = 52.5 / 25.4;
  const tok = (base: Token['base'], x: number, y: number, rotation = 0, modelIndex = 0): Token => ({
    modelIndex,
    base,
    x,
    y,
    rotation,
  });

  it('two 170x105 ovals with a true gap of 0.55" are not coherent; 0.45" are', () => {
    // End to end along their length, and side by side across their width.
    expect(checkCoherency([tok(big, 0, 0), tok(big, 2 * hl + 0.55, 0, 0, 1)]).coherent).toBe(false);
    expect(checkCoherency([tok(big, 0, 0), tok(big, 2 * hl + 0.45, 0, 0, 1)]).coherent).toBe(true);
    expect(checkCoherency([tok(big, 0, 0, 90), tok(big, 2 * hw + 0.55, 0, 90, 1)]).coherent).toBe(
      false,
    );
    expect(checkCoherency([tok(big, 0, 0, 90), tok(big, 2 * hw + 0.45, 0, 90, 1)]).coherent).toBe(
      true,
    );
  });

  it('a 32mm base 0.52" from a 170x105 oval is not coherent; 0.48" is', () => {
    const r = 16 / 25.4;
    for (const [x, y, rot] of [
      [hl + 0.52 + r, 0, 0],
      [0, hw + 0.52 + r, 0],
      [hw + 0.52 + r, 0, 90],
    ] as const) {
      expect(checkCoherency([tok(big, 0, 0, rot), tok(round(32), x, y, 0, 1)]).coherent).toBe(
        false,
      );
    }
    expect(checkCoherency([tok(big, 0, 0), tok(round(32), hl + 0.48 + r, 0, 0, 1)]).coherent).toBe(
      true,
    );
  });

  it('property: a circle-oval pair accepted as coherent has a true gap of at most 1/2"', () => {
    fc.assert(
      fc.property(
        fc.constantFrom([60, 35] as const, [105, 70] as const, [170, 105] as const),
        fc.constantFrom(25, 32, 50),
        fc.integer({ min: 0, max: 359 }),
        fc.integer({ min: 0, max: 359 }),
        fc.integer({ min: 0, max: 100 }),
        ([l, w], d, rot, dir, extra) => {
          const e = baseFootprint(oval(l, w), 0, 0, rot);
          const c0 = baseFootprint(round(d), 0, 0);
          const r = c0.kind === 'circle' ? c0.r : 0;
          // Put the circle in direction `dir`, about 0.3"-0.8" from the oval.
          const a = (dir * Math.PI) / 180;
          const reach = Math.max(l, w) / 2 / 25.4 + r + 0.3 + extra / 200;
          const c = baseFootprint(round(d), reach * Math.cos(a), reach * Math.sin(a));
          const trueGap =
            Math.min(...outlinePoints(e, 3600).map(([x, y]) => Math.hypot(x - c.cx, y - c.cy))) - r;
          if (withinCoherencyRange(e, c, 0.5)) expect(trueGap).toBeLessThanOrEqual(0.5 + 1e-5);
          // The sampled outline is itself accurate to ~1e-6".
          expect(footprintCoherencyGap(e, c)).toBeGreaterThanOrEqual(trueGap - 1e-5);
          expect(footprintCoherencyGap(e, c)).toBeLessThanOrEqual(trueGap + 0.003);
        },
      ),
      { numRuns: 300, seed: 20261102 },
    );
  });
});
