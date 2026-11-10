import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formationTemplate } from './formation.js';
import {
  DEFAULT_FORMATION_GAP_IN,
  checkCoherency,
  clearFormationCache,
  warmFormation,
  effectiveFrontage,
  footprintGap,
  footprintsOverlap,
  layoutFormation,
  tokenFootprint,
  type Token,
} from './index.js';
import { arbUnit, nth, oval, round, trulyOverlap } from './test-helpers.js';

function selfOverlaps(tokens: readonly Token[]): [number, number][] {
  const fps = tokens.map(tokenFootprint);
  const out: [number, number][] = [];
  for (let i = 0; i < fps.length; i++)
    for (let j = i + 1; j < fps.length; j++) {
      const a = fps[i];
      const b = fps[j];
      if (a && b && (footprintsOverlap(a, b) || trulyOverlap(a, b))) out.push([i, j]);
    }
  return out;
}

describe('layoutFormation', () => {
  it('returns one token per model, in input order, with the input bases', () => {
    const models = [round(40), round(32), round(32)];
    const tokens = layoutFormation(models, 3, [30, 30], 0);
    expect(tokens.map((t) => t.modelIndex)).toEqual([0, 1, 2]);
    expect(tokens.map((t) => t.base)).toEqual(models);
    expect(layoutFormation([], 5, [0, 0], 0)).toEqual([]);
  });

  it('a row of 5 x 32mm at 0 degrees: one line, centred, exactly gapIn apart', () => {
    const tokens = layoutFormation(Array(5).fill(round(32)), 5, [30, 30], 0);
    const d = 32 / 25.4;
    expect(tokens.every((t) => Math.abs(t.y - 30) < 1e-9)).toBe(true);
    expect(tokens[2]?.x).toBeCloseTo(30, 9);
    for (let i = 1; i < 5; i++)
      expect((tokens[i]?.x ?? 0) - (tokens[i - 1]?.x ?? 0)).toBeCloseTo(d + 0.25, 9);
    expect(checkCoherency(tokens).coherent).toBe(true);
  });

  it('rows are staggered and hex-packed for uniform bases', () => {
    const tokens = layoutFormation(Array(10).fill(round(32)), 5, [30, 30], 0);
    const fps = tokens.map(tokenFootprint);
    // Model 5 (second row, first) sits in the notch of models 0 and 1, exactly gapIn from both.
    expect(footprintGap(nth(fps, 5), nth(fps, 0))).toBeCloseTo(0.25, 6);
    expect(footprintGap(nth(fps, 5), nth(fps, 1))).toBeCloseTo(0.25, 6);
    expect(nth(tokens, 5).y).toBeGreaterThan(nth(tokens, 0).y); // later rows go back (+y at 0 deg)
  });

  it('rotation turns the whole block clockwise about the centre', () => {
    const at0 = layoutFormation(Array(5).fill(round(32)), 5, [30, 30], 0);
    const at90 = layoutFormation(Array(5).fill(round(32)), 5, [30, 30], 90);
    at0.forEach((t, i) => {
      // (dx, dy) -> (-dy, dx) for 90 deg clockwise with y down.
      expect(nth(at90, i).x).toBeCloseTo(30 - (t.y - 30), 9);
      expect(nth(at90, i).y).toBeCloseTo(30 + (t.x - 30), 9);
    });
    expect(at90.every((t) => t.rotation === 90)).toBe(true);
  });

  it('ovals face forward: length along the facing direction (token rotation + 90)', () => {
    const tokens = layoutFormation(Array(3).fill(oval(75, 42)), 3, [30, 30], 0);
    expect(tokens.map((t) => t.rotation)).toEqual([90, 90, 90]);
    // Side by side across their width: 42mm + the 0.25" gap (the outer polygon's axis
    // extents are exact).
    expect(nth(tokens, 1).x - nth(tokens, 0).x).toBeCloseTo(42 / 25.4 + 0.25, 6);
    expect(nth(layoutFormation([oval(75, 42)], 1, [0, 0], 300), 0).rotation).toBe(30);
  });

  it('frontage is clamped to [1, N] and is at least 2 for units of 7+', () => {
    expect(effectiveFrontage(5, 0)).toBe(1);
    expect(effectiveFrontage(5, 9)).toBe(5);
    expect(effectiveFrontage(7, 1)).toBe(2);
    expect(effectiveFrontage(3, 2.6)).toBe(3);
    expect(effectiveFrontage(4, Number.NaN)).toBe(1);
  });

  it('a column of 10 (frontage 1) is still coherent', () => {
    expect(
      checkCoherency(layoutFormation(Array(10).fill(round(25)), 1, [30, 30], 0)).coherent,
    ).toBe(true);
  });

  it('mixed bases stay coherent (big champion + small models, ovals + rounds)', () => {
    const cases = [
      [round(100), ...Array(7).fill(round(25))],
      [round(40), ...Array(4).fill(oval(60, 35))],
      [oval(120, 92), round(25), round(25), round(25), round(25), round(25), round(25)],
    ];
    for (const models of cases) {
      for (const frontage of [1, 2, 3, 5]) {
        const tokens = layoutFormation(models, frontage, [30, 22], 45);
        expect(checkCoherency(tokens).coherent).toBe(true);
        expect(selfOverlaps(tokens)).toEqual([]);
      }
    }
  });

  it('rejects a gap that cannot be coherent', () => {
    expect(() => layoutFormation([round(32)], 1, [0, 0], 0, 0.6)).toThrow(RangeError);
    expect(() => layoutFormation([round(32)], 1, [0, 0], 0, 0)).toThrow(RangeError);
  });

  it('property: output is always coherent and never self-overlaps', () => {
    fc.assert(
      fc.property(
        arbUnit,
        fc.integer({ min: 1, max: 12 }),
        fc.tuple(
          fc.double({ min: 0, max: 60, noNaN: true }),
          fc.double({ min: 0, max: 44, noNaN: true }),
        ),
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: 0.05, max: 0.5, noNaN: true }),
        (models, frontage, centre, rotation, gap) => {
          const tokens = layoutFormation(models, frontage, centre, rotation, gap);
          expect(tokens).toHaveLength(models.length);
          const coherency = checkCoherency(tokens);
          expect(coherency).toMatchObject({ coherent: true });
          expect(selfOverlaps(tokens)).toEqual([]);
        },
      ),
      { numRuns: 300, seed: 0x4d34_5400 },
    );
  }, 60_000);

  it('property: deterministic, and a cached result equals a cold computation', () => {
    fc.assert(
      fc.property(
        arbUnit,
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (models, f, rot) => {
          clearFormationCache();
          const cold = layoutFormation(models, f, [30, 22], rot);
          const warm = layoutFormation(models, f, [30, 22], rot);
          clearFormationCache();
          const coldAgain = layoutFormation(models, f, [30, 22], rot);
          expect(warm).toEqual(cold);
          expect(coldAgain).toEqual(cold);
        },
      ),
      { numRuns: 50, seed: 0x4d34_5401 },
    );
  }, 60_000);

  it('warmFormation precomputes layouts so later calls match a cold call', () => {
    const models = [round(40), ...Array(9).fill(oval(60, 35))];
    clearFormationCache();
    const cold = [1, 2, 3, 5].map((f) => layoutFormation(models, f, [10, 30], 15));
    clearFormationCache();
    warmFormation(models, [1, 2, 3, 5]);
    expect([1, 2, 3, 5].map((f) => layoutFormation(models, f, [10, 30], 15))).toEqual(cold);
  });

  it('huge ovals at the largest gap still count as coherent (gap is capped by a margin)', () => {
    for (const models of [
      Array(8).fill(oval(170, 105)),
      [round(32), ...Array(6).fill(oval(170, 105))],
      [oval(280, 210), round(25), round(25)],
    ]) {
      for (const frontage of [1, 2, 4]) {
        const tokens = layoutFormation(models, frontage, [30, 22], 33, 0.5);
        expect(checkCoherency(tokens).coherent).toBe(true);
        expect(selfOverlaps(tokens)).toEqual([]);
      }
    }
  });
});

describe('layoutFormation options.stagger (M4-T02)', () => {
  const g = DEFAULT_FORMATION_GAP_IN;
  const aligned = { stagger: false } as const;

  it('stagger: false gives aligned ranks and files for uniform bases', () => {
    const d = 32 / 25.4;
    const tokens = layoutFormation(Array(10).fill(round(32)), 5, [30, 30], 0, g, aligned);
    for (let k = 0; k < 5; k++) {
      const front = nth(tokens, k);
      const back = nth(tokens, k + 5);
      expect(back.x).toBeCloseTo(front.x, 9); // same file
      expect(back.y - front.y).toBeCloseTo(d + g, 6); // one rank back, exactly gapIn apart
    }
    expect(checkCoherency(tokens).coherent).toBe(true);
    expect(selfOverlaps(tokens)).toEqual([]);
    // The default layout of the same unit is staggered.
    const staggered = layoutFormation(Array(10).fill(round(32)), 5, [30, 30], 0);
    expect(Math.abs(nth(staggered, 5).x - nth(staggered, 0).x)).toBeGreaterThan(0.5);
  });

  it('stagger: false with frontage 1 is a straight column', () => {
    const tokens = layoutFormation(Array(6).fill(round(25)), 1, [30, 30], 0, g, aligned);
    expect(tokens.every((t) => Math.abs(t.x - 30) < 1e-9)).toBe(true);
    expect(checkCoherency(tokens).coherent).toBe(true);
  });

  it('stagger: false still repairs a lone last-rank model of a 7+ unit (2 neighbours)', () => {
    const tokens = layoutFormation(Array(7).fill(round(32)), 2, [30, 30], 0, g, aligned);
    expect(checkCoherency(tokens).coherent).toBe(true);
    expect(selfOverlaps(tokens)).toEqual([]);
    // The six models in full ranks keep their grid slots.
    for (let k = 0; k < 4; k++) expect(nth(tokens, k + 2).x).toBeCloseTo(nth(tokens, k).x, 9);
  });

  it('stagger: false with mixed bases (champions, ovals) stays coherent and never overlaps', () => {
    const cases = [
      [round(100), ...Array(7).fill(round(25))],
      [round(40), ...Array(4).fill(oval(60, 35))],
      [oval(120, 92), round(25), round(25), round(25), round(25), round(25), round(25)],
      Array(8).fill(oval(170, 105)),
    ];
    for (const models of cases) {
      for (const frontage of [1, 2, 3, 5]) {
        const tokens = layoutFormation(models, frontage, [30, 22], 45, g, aligned);
        expect(checkCoherency(tokens).coherent).toBe(true);
        expect(selfOverlaps(tokens)).toEqual([]);
      }
    }
  });

  it('property: aligned output is always coherent and never self-overlaps', () => {
    fc.assert(
      fc.property(
        arbUnit,
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: 0.05, max: 0.5, noNaN: true }),
        (models, frontage, rotation, gap) => {
          const tokens = layoutFormation(models, frontage, [30, 22], rotation, gap, aligned);
          expect(tokens).toHaveLength(models.length);
          expect(checkCoherency(tokens)).toMatchObject({ coherent: true });
          expect(selfOverlaps(tokens)).toEqual([]);
        },
      ),
      { numRuns: 200, seed: 0x4d34_5402 },
    );
  }, 60_000);

  it('property: omitted options, {} and stagger: true are byte-identical to the default', () => {
    fc.assert(
      fc.property(
        arbUnit,
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (models, f, rot) => {
          clearFormationCache();
          const cold = JSON.stringify(layoutFormation(models, f, [30, 22], rot));
          clearFormationCache();
          // An aligned layout in the cache must not leak into the default one (separate keys).
          layoutFormation(models, f, [30, 22], rot, g, aligned);
          expect(JSON.stringify(layoutFormation(models, f, [30, 22], rot))).toBe(cold);
          expect(JSON.stringify(layoutFormation(models, f, [30, 22], rot, g, {}))).toBe(cold);
          expect(
            JSON.stringify(layoutFormation(models, f, [30, 22], rot, g, { stagger: true })),
          ).toBe(cold);
          expect(JSON.stringify(formationTemplate(models, f, rot).tokensAt(30, 22))).toBe(cold);
        },
      ),
      { numRuns: 50, seed: 0x4d34_5403 },
    );
  }, 60_000);

  it('formationTemplate and warmFormation honour the option (cached equals cold)', () => {
    const models = [round(40), ...Array(9).fill(oval(60, 35))];
    clearFormationCache();
    const cold = [1, 2, 3, 5].map((f) => layoutFormation(models, f, [10, 30], 15, g, aligned));
    clearFormationCache();
    warmFormation(models, [1, 2, 3, 5], g, aligned);
    expect([1, 2, 3, 5].map((f) => layoutFormation(models, f, [10, 30], 15, g, aligned))).toEqual(
      cold,
    );
    expect(formationTemplate(models, 3, 15, g, aligned).tokensAt(10, 30)).toEqual(cold[2]);
  });
});
