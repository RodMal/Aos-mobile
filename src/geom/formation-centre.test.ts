import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formationTemplate } from './formation.js';
import {
  DEFAULT_FORMATION_GAP_IN,
  checkCoherency,
  clearFormationCache,
  footprintsOverlap,
  layoutFormation,
  tokenFootprint,
  warmFormation,
  type FormationOptions,
  type Token,
} from './index.js';
import { arbUnit, nth, oval, round, trulyOverlap } from './test-helpers.js';

const g = DEFAULT_FORMATION_GAP_IN;

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

/**
 * For uniform bases, the centred layout puts model `slots[s]` exactly where the default
 * layout puts model `s` (same bases in every slot, so the same row geometry).
 */
function expectSlots(n: number, frontage: number, opts: FormationOptions, slots: number[]): void {
  const models = Array(n).fill(round(32));
  const base = { stagger: opts.stagger ?? true };
  const plain = layoutFormation(models, frontage, [30, 22], 0, g, base);
  const centred = layoutFormation(models, frontage, [30, 22], 0, g, opts);
  expect(centred.map((t) => t.modelIndex)).toEqual(models.map((_, i) => i));
  slots.forEach((model, slot) => {
    expect(nth(centred, model).x).toBeCloseTo(nth(plain, slot).x, 9);
    expect(nth(centred, model).y).toBeCloseTo(nth(plain, slot).y, 9);
  });
  expect(checkCoherency(centred).coherent).toBe(true);
  expect(selfOverlaps(centred)).toEqual([]);
}

describe('layoutFormation options.centreChampions (M4-T23)', () => {
  for (const stagger of [true, false]) {
    const tag = stagger ? 'staggered' : 'aligned';

    it(`${tag}: 1 champion, odd front (5) stands in the middle slot`, () => {
      expectSlots(10, 5, { stagger, centreChampions: 1 }, [1, 2, 0, 3, 4, 5, 6, 7, 8, 9]);
    });

    it(`${tag}: 1 champion, even front (4) stands left of centre`, () => {
      expectSlots(8, 4, { stagger, centreChampions: 1 }, [1, 0, 2, 3, 4, 5, 6, 7]);
    });

    it(`${tag}: 2 champions (reinforced, ADR 0033) take the two middle slots`, () => {
      // Odd gap (5 - 2 = 3): one more slot on the right.
      expectSlots(
        16,
        5,
        { stagger, centreChampions: 2 },
        [2, 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      );
      // Even gap (6 - 2 = 4): exactly centred.
      expectSlots(
        16,
        6,
        { stagger, centreChampions: 2 },
        [2, 3, 0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      );
    });

    it(`${tag}: 3 champions on a front of 5 take slots 1..3`, () => {
      expectSlots(10, 5, { stagger, centreChampions: 3 }, [3, 0, 1, 2, 4, 5, 6, 7, 8, 9]);
    });

    it(`${tag}: champions beyond the front rank overflow into the centre of rank 2`, () => {
      // 4 champions, front of 3: the 4th is in the middle of rank 2.
      expectSlots(9, 3, { stagger, centreChampions: 4 }, [0, 1, 2, 4, 3, 5, 6, 7, 8]);
      // 3 champions, front of 2: the 3rd stands left of centre in rank 2, which is slot 2
      // anyway, so the layout is the default one.
      const models = Array(8).fill(round(32));
      expect(layoutFormation(models, 2, [30, 22], 0, g, { stagger, centreChampions: 3 })).toEqual(
        layoutFormation(models, 2, [30, 22], 0, g, { stagger }),
      );
    });
  }

  it('overflow in rank 2: straight behind the centre when aligned, half a pitch off when staggered', () => {
    const models = Array(9).fill(round(32));
    const aligned = layoutFormation(models, 3, [30, 22], 0, g, {
      stagger: false,
      centreChampions: 4,
    });
    expect(nth(aligned, 3).x).toBeCloseTo(nth(aligned, 1).x, 9);
    const staggered = layoutFormation(models, 3, [30, 22], 0, g, { centreChampions: 4 });
    expect(Math.abs(nth(staggered, 3).x - nth(staggered, 1).x)).toBeCloseTo((32 / 25.4 + g) / 2, 6);
  });

  it('the front rank is centred the same with and without stagger', () => {
    const models = Array(10).fill(round(32));
    const a = layoutFormation(models, 5, [30, 22], 0, g, { stagger: false, centreChampions: 1 });
    const s = layoutFormation(models, 5, [30, 22], 0, g, { centreChampions: 1 });
    // Champion is the median x of the front rank in both.
    for (const tokens of [a, s]) {
      const frontY = Math.min(...tokens.map((t) => t.y));
      const front = tokens.filter((t) => Math.abs(t.y - frontY) < 1e-9).map((t) => t.x);
      front.sort((p, q) => p - q);
      expect(front).toHaveLength(5);
      expect(nth(tokens, 0).x).toBeCloseTo(nth(front, 2), 9);
    }
  });

  it('default unchanged: absent, 0, negative, n = 1 and frontage 1 are bit-identical', () => {
    const models = [round(40), ...Array(9).fill(round(32))];
    const plain = JSON.stringify(layoutFormation(models, 5, [30, 22], 30));
    for (const centreChampions of [0, -1, Number.NaN])
      expect(JSON.stringify(layoutFormation(models, 5, [30, 22], 30, g, { centreChampions }))).toBe(
        plain,
      );
    const one = [round(40)];
    expect(layoutFormation(one, 5, [3, 3], 0, g, { centreChampions: 1 })).toEqual(
      layoutFormation(one, 5, [3, 3], 0),
    );
    const column = Array(5).fill(round(25));
    expect(layoutFormation(column, 1, [3, 3], 0, g, { centreChampions: 1 })).toEqual(
      layoutFormation(column, 1, [3, 3], 0),
    );
  });

  it('mixed bases: tokens stay sorted by modelIndex with their own bases', () => {
    const models = [round(40), round(40), ...Array(10).fill(oval(60, 35))];
    const tokens = layoutFormation(models, 5, [30, 22], 0, g, { centreChampions: 2 });
    expect(tokens.map((t) => t.modelIndex)).toEqual(models.map((_, i) => i));
    expect(tokens.map((t) => t.base)).toEqual(models);
    expect(checkCoherency(tokens).coherent).toBe(true);
    expect(selfOverlaps(tokens)).toEqual([]);
  });

  it('deterministic: cold, cached, warmed and template layouts are equal; keys do not collide', () => {
    const models = [round(40), ...Array(9).fill(round(32))];
    const opts = { centreChampions: 1 } as const;
    clearFormationCache();
    const plainCold = JSON.stringify(layoutFormation(models, 5, [10, 30], 15));
    clearFormationCache();
    const cold = JSON.stringify(layoutFormation(models, 5, [10, 30], 15, g, opts));
    expect(cold).not.toBe(plainCold);
    // Cached centred layout must not leak into the default key, nor the reverse.
    expect(JSON.stringify(layoutFormation(models, 5, [10, 30], 15))).toBe(plainCold);
    expect(JSON.stringify(layoutFormation(models, 5, [10, 30], 15, g, opts))).toBe(cold);
    clearFormationCache();
    warmFormation(models, [5], g, opts);
    expect(JSON.stringify(layoutFormation(models, 5, [10, 30], 15, g, opts))).toBe(cold);
    expect(JSON.stringify(formationTemplate(models, 5, 15, g, opts).tokensAt(10, 30))).toBe(cold);
    // Different champion counts are different layouts.
    expect(
      JSON.stringify(layoutFormation(models, 5, [10, 30], 15, g, { centreChampions: 2 })),
    ).not.toBe(cold);
  });

  it('property: any bases, frontage, stagger and k stay coherent and never self-overlap', () => {
    fc.assert(
      fc.property(
        arbUnit,
        fc.integer({ min: 1, max: 12 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 4 }),
        fc.double({ min: -360, max: 360, noNaN: true }),
        (models, frontage, stagger, centreChampions, rotation) => {
          const tokens = layoutFormation(models, frontage, [30, 22], rotation, g, {
            stagger,
            centreChampions,
          });
          expect(tokens.map((t) => t.modelIndex)).toEqual(models.map((_, i) => i));
          expect(checkCoherency(tokens)).toMatchObject({ coherent: true });
          expect(selfOverlaps(tokens)).toEqual([]);
        },
      ),
      { numRuns: 150, seed: 0x4d34_5423 },
    );
  }, 60_000);
});
