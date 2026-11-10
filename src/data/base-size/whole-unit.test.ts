import { describe, expect, it } from 'vitest';
import type { BaseShape, BaseSizePart, BaseSizeSpec } from '../schema/base-size.js';
import {
  fractionWarnings,
  isWholeUnitFraction,
  resolveModelBases,
  siblingBaseModels,
} from './resolve.js';

/** ADR 0032: base-size fractions written over the whole unit size (M1-T29). */

const round = (diameterMm: number): BaseShape => ({ kind: 'round', diameterMm });
const part = (d: number, frac?: [number, number]): BaseSizePart => ({
  shape: round(d),
  alternatives: [],
  champion: false,
  ...(frac ? { fraction: { num: frac[0], den: frac[1] } } : {}),
});
const spec = (raw: string, parts: BaseSizePart[], source: BaseSizeSpec['source'] = 'data') => ({
  raw,
  parts,
  source,
  warnings: [],
});

const flameseeker = [part(32, [2, 9]), part(28.5, [5, 9])];
const killaz = [part(40, [1, 7]), part(32, [6, 7]), part(28.5, [1, 7])];
const tithe = [part(32, [3, 5]), part(25, [2, 8])];

describe('isWholeUnitFraction (ADR 0032 §1)', () => {
  it('is true when S < D and S plus the siblings equals D', () => {
    expect(isWholeUnitFraction(flameseeker, { siblingModels: 2 })).toBe(true);
  });

  it('is false when the siblings do not fill D, or overfill it', () => {
    expect(isWholeUnitFraction(flameseeker, { siblingModels: 1 })).toBe(false);
    expect(isWholeUnitFraction(flameseeker, { siblingModels: 3 })).toBe(false);
  });

  it('is false for a sum of 1 or more, mixed denominators, a missing fraction or no parts', () => {
    expect(isWholeUnitFraction(killaz, { siblingModels: 0 })).toBe(false);
    expect(isWholeUnitFraction([part(32, [9, 9])], { siblingModels: 0 })).toBe(false);
    expect(isWholeUnitFraction(tithe, { siblingModels: 3 })).toBe(false);
    expect(isWholeUnitFraction([part(32, [2, 9]), part(25)], { siblingModels: 7 })).toBe(false);
    expect(isWholeUnitFraction([], { siblingModels: 0 })).toBe(false);
  });
});

describe('fractionWarnings with unit context', () => {
  it('drops only BASE_SIZE_FRACTIONS_SUM for a whole-unit spec', () => {
    expect(fractionWarnings(flameseeker, { siblingModels: 2 })).toEqual([]);
  });

  it('keeps the ADR 0009 warning without context (ADR 0032 §4)', () => {
    expect(fractionWarnings(flameseeker)).toEqual([
      'BASE_SIZE_FRACTIONS_SUM: fractions sum to 7/9, not 1',
    ]);
  });

  it('keeps every other case unchanged (ADR 0032 §2)', () => {
    expect(fractionWarnings(flameseeker, { siblingModels: 1 })).toEqual([
      'BASE_SIZE_FRACTIONS_SUM: fractions sum to 7/9, not 1',
    ]);
    expect(fractionWarnings(killaz, { siblingModels: 0 })).toEqual([
      'BASE_SIZE_FRACTIONS_SUM: fractions sum to 8/7, not 1',
    ]);
    expect(fractionWarnings(tithe, { siblingModels: 3 })).toEqual([
      'BASE_SIZE_MIXED_DENOMINATORS: denominators 5, 8 are mixed',
      'BASE_SIZE_FRACTIONS_SUM: fractions sum to 17/20, not 1',
    ]);
  });
});

describe('siblingBaseModels', () => {
  const groups = [
    { min: 1, base: spec('32mm', [part(32)]) },
    { min: 1, base: spec('', [], 'fallback') }, // no Base Size rule: not counted
    { min: 2, base: spec('use model', [], 'fallback') }, // has a rule, unparsed: counted
    { min: 7, base: spec('2/9 32mm\n5/9 28.5mm', flameseeker) },
  ];

  it('sums the base-size minimums of the other groups that have a Base Size rule', () => {
    expect(siblingBaseModels(groups, 3)).toBe(3);
    expect(siblingBaseModels(groups, 0)).toBe(9);
  });
});

describe('resolveModelBases with unit context', () => {
  const s = spec('2/9 32mm\n5/9 28.5mm', flameseeker);

  it('gives the same bases with or without context, and no sum warning with it', () => {
    const plain = resolveModelBases(s, 7);
    const withUnit = resolveModelBases(s, 7, undefined, { siblingModels: 2 });
    expect(withUnit.bases).toEqual(plain.bases);
    expect(withUnit.bases.map((b) => (b.kind === 'round' ? b.diameterMm : 0))).toEqual([
      32, 32, 28.5, 28.5, 28.5, 28.5, 28.5,
    ]);
    expect(plain.warnings).toEqual(['BASE_SIZE_FRACTIONS_SUM: fractions sum to 7/9, not 1']);
    expect(withUnit.warnings).toEqual([]);
  });
});
