import { describe, expect, it } from 'vitest';
import {
  BaseSizeSpecSchema,
  type BaseShape,
  type BaseSizePart,
  type BaseSizeSpec,
} from '../schema/base-size.js';
import { largestRemainder, resolveBases, resolveModelBases } from './resolve.js';

const round = (diameterMm: number): BaseShape => ({ kind: 'round', diameterMm });
const oval = (lengthMm: number, widthMm: number): BaseShape => ({
  kind: 'oval',
  lengthMm,
  widthMm,
});

function part(
  shape: BaseShape,
  opts: { frac?: [number, number]; champion?: boolean; alternatives?: BaseShape[] } = {},
): BaseSizePart {
  const p: BaseSizePart = {
    shape,
    alternatives: opts.alternatives ?? [],
    champion: opts.champion ?? false,
  };
  if (opts.frac) p.fraction = { num: opts.frac[0], den: opts.frac[1] };
  if (opts.champion) p.note = 'Champion';
  return p;
}

function spec(raw: string, parts: BaseSizePart[]): BaseSizeSpec {
  return BaseSizeSpecSchema.parse({ raw, parts, source: 'data', warnings: [] });
}

const mm = (bases: BaseShape[]): string[] =>
  bases.map((b) =>
    b.kind === 'round'
      ? `${b.diameterMm}`
      : b.kind === 'oval' || b.kind === 'rect'
        ? `${b.lengthMm}x${b.widthMm}`
        : 'useModel',
  );

describe('largestRemainder', () => {
  it('reproduces exact quotas', () => {
    expect(largestRemainder(8, [1, 4, 3])).toEqual([1, 4, 3]);
  });
  it('hands leftovers to the largest remainders, ties by order', () => {
    expect(largestRemainder(5, [1, 1])).toEqual([3, 2]);
    expect(largestRemainder(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });
  it('treats all-zero weights as equal', () => {
    expect(largestRemainder(3, [0, 0])).toEqual([2, 1]);
  });
  it('returns [] for no weights', () => {
    expect(largestRemainder(3, [])).toEqual([]);
  });
});

describe('resolveModelBases', () => {
  it('step 1: single part without fraction applies to every model', () => {
    const r = resolveModelBases(spec('40mm', [part(round(40))]), 10);
    expect(mm(r.bases)).toEqual(Array(10).fill('40'));
    expect(r.fallback).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('handles zero models', () => {
    expect(resolveModelBases(spec('40mm', [part(round(40))]), 0).bases).toEqual([]);
  });

  it('step 4: N equal to the denominator reproduces the numerators', () => {
    const s = spec('1/8 40mm (Champion)\n4/8 32mm\n3/8 28.5mm', [
      part(round(40), { frac: [1, 8], champion: true }),
      part(round(32), { frac: [4, 8] }),
      part(round(28.5), { frac: [3, 8] }),
    ]);
    const r = resolveModelBases(s, 8);
    expect(mm(r.bases)).toEqual(['40', '32', '32', '32', '32', '28.5', '28.5', '28.5']);
    expect(r.warnings).toEqual([]);
  });

  it('champions are fixed and do not scale with reinforced units', () => {
    const s = spec('1/8 40mm (Champion)\n4/8 32mm\n3/8 28.5mm', [
      part(round(40), { frac: [1, 8], champion: true }),
      part(round(32), { frac: [4, 8] }),
      part(round(28.5), { frac: [3, 8] }),
    ]);
    const counts = (n: number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const b of mm(resolveModelBases(s, n).bases)) out[b] = (out[b] ?? 0) + 1;
      return out;
    };
    // R = 15: 4/7*15 = 8.57, 3/7*15 = 6.43 -> 8 + 6 = 14, leftover to 32mm (.57 > .43).
    expect(counts(16)).toEqual({ '40': 1, '32': 9, '28.5': 6 });
    expect(counts(1)).toEqual({ '40': 1 });
  });

  it('puts champion bases first even when the champion line is not first', () => {
    const s = spec('60x35mm\n40mm (Champion)', [
      part(oval(60, 35)),
      part(round(40), { champion: true }),
    ]);
    expect(mm(resolveModelBases(s, 3).bases)).toEqual(['40', '60x35', '60x35']);
  });

  it('uses the primary shape of an OR line', () => {
    const s = spec('1/8 40mm OR 32mm\n1/8 32mm\n3/8 28.5mm', [
      part(round(40), { frac: [1, 8], alternatives: [round(32)] }),
      part(round(32), { frac: [1, 8] }),
      part(round(28.5), { frac: [3, 8] }),
    ]);
    const r = resolveModelBases(s, 5);
    expect(mm(r.bases)).toEqual(['40', '32', '28.5', '28.5', '28.5']);
    expect(r.warnings).toEqual(['BASE_SIZE_FRACTIONS_SUM: fractions sum to 5/8, not 1']);
  });

  it('normalises fractions that do not sum to 1 and warns', () => {
    const s = spec('1/7 40mm (Champion)\n6/7 32mm\n1/7 28.5mm', [
      part(round(40), { frac: [1, 7], champion: true }),
      part(round(32), { frac: [6, 7] }),
      part(round(28.5), { frac: [1, 7] }),
    ]);
    const r = resolveModelBases(s, 7);
    expect(mm(r.bases)).toEqual(['40', '32', '32', '32', '32', '32', '28.5']);
    expect(r.warnings).toEqual(['BASE_SIZE_FRACTIONS_SUM: fractions sum to 8/7, not 1']);
  });

  it('warns about mixed denominators', () => {
    const s = spec('3/5 32mm\n2/8 25mm', [
      part(round(32), { frac: [3, 5] }),
      part(round(25), { frac: [2, 8] }),
    ]);
    const r = resolveModelBases(s, 5);
    expect(r.bases).toHaveLength(5);
    expect(r.warnings).toContain('BASE_SIZE_MIXED_DENOMINATORS: denominators 5, 8 are mixed');
    expect(r.warnings).toContain('BASE_SIZE_FRACTIONS_SUM: fractions sum to 17/20, not 1');
  });

  it('gives a line without a fraction the rest of the weight', () => {
    const s = spec('1/5 40mm (Champion)\n2/5 32mm\n25mm', [
      part(round(40), { frac: [1, 5], champion: true }),
      part(round(32), { frac: [2, 5] }),
      part(round(25)),
    ]);
    const r = resolveModelBases(s, 5);
    expect(mm(r.bases)).toEqual(['40', '32', '32', '25', '25']);
    expect(r.warnings[0]).toMatch(/^BASE_SIZE_MISSING_FRACTION/);
  });

  it('caps champion counts at the model count', () => {
    const s = spec('3/10 32mm (Champion)\n7/10 28.5mm', [
      part(round(32), { frac: [3, 10], champion: true }),
      part(round(28.5), { frac: [7, 10] }),
    ]);
    expect(mm(resolveModelBases(s, 2).bases)).toEqual(['32', '32']);
  });

  it('champions split a shared line and warn only when base exceeds the line total (ADR 0033)', () => {
    const s = spec('3/10 32mm (Champion)\n7/10 28.5mm', [
      part(round(32), { frac: [3, 10], champion: true }),
      part(round(28.5), { frac: [7, 10] }),
    ]);
    const same = resolveModelBases(s, 10, { base: 3, actual: 3 });
    expect(mm(same.bases)).toEqual([...Array(3).fill('32'), ...Array(7).fill('28.5')]);
    expect(same.warnings).toEqual([]);
    // One champion plus a shared 2/10 on 32mm: the same bases at the box size.
    const one = resolveModelBases(s, 10, { base: 1, actual: 1 });
    expect(mm(one.bases)).toEqual(mm(same.bases));
    expect(one.warnings).toEqual([]);
    const over = resolveModelBases(s, 10, { base: 4, actual: 4 });
    expect(over.warnings[0]).toMatch(/^BASE_SIZE_CHAMPION_COUNT/);
  });

  it('champions are ignored when the spec has no champion lines', () => {
    const s = spec('2/9 32mm\n5/9 28.5mm', [
      part(round(32), { frac: [2, 9] }),
      part(round(28.5), { frac: [5, 9] }),
    ]);
    const r = resolveModelBases(s, 7, { base: 1, actual: 2 });
    expect(mm(r.bases)).toEqual(['32', '32', '28.5', '28.5', '28.5', '28.5', '28.5']);
  });

  it('falls back to 32mm for "Use model" with a warning', () => {
    const r = resolveModelBases(spec('Use model', [part({ kind: 'useModel' })]), 2);
    expect(r.bases).toEqual([round(32), round(32)]);
    expect(r.fallback).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^BASE_SIZE_FALLBACK/);
  });

  it('falls back to 32mm for an unparsed spec (no parts)', () => {
    const s = BaseSizeSpecSchema.parse({
      raw: 'huge',
      parts: [],
      source: 'fallback',
      warnings: ['BASE_SIZE_UNPARSED: x'],
    });
    const r = resolveModelBases(s, 3);
    expect(r.bases).toEqual([round(32), round(32), round(32)]);
    expect(r.fallback).toBe(true);
  });

  it('gives extra models to the last champion base when there are only champion lines', () => {
    const s = spec('1/2 40mm (Champion)\n1/2 32mm (Champion)', [
      part(round(40), { frac: [1, 2], champion: true }),
      part(round(32), { frac: [1, 2], champion: true }),
    ]);
    const r = resolveModelBases(s, 4);
    expect(mm(r.bases)).toEqual(['40', '32', '32', '32']);
    expect(r.warnings.some((w) => w.startsWith('BASE_SIZE_CHAMPION_OVERFLOW'))).toBe(true);
  });

  it('only reports a fallback when a model actually gets the fallback base', () => {
    const s = spec('1/2 40mm (Champion)\n1/2 Use model', [
      part(round(40), { frac: [1, 2], champion: true }),
      part({ kind: 'useModel' }, { frac: [1, 2] }),
    ]);
    const one = resolveModelBases(s, 1);
    expect(mm(one.bases)).toEqual(['40']);
    expect(one.fallback).toBe(false);
    expect(one.warnings).toEqual([]);
    const two = resolveModelBases(s, 2);
    expect(mm(two.bases)).toEqual(['40', '32']);
    expect(two.fallback).toBe(true);
    expect(resolveModelBases(spec('Use model', [part({ kind: 'useModel' })]), 0)).toEqual({
      bases: [],
      fallback: false,
      warnings: [],
    });
  });

  it('warns when fractions leave nothing for lines without a fraction', () => {
    const s = spec('1/2 40mm\n1/2 32mm\n25mm', [
      part(round(40), { frac: [1, 2] }),
      part(round(32), { frac: [1, 2] }),
      part(round(25)),
    ]);
    const r = resolveModelBases(s, 4);
    expect(mm(r.bases)).toEqual(['40', '40', '32', '32']);
    expect(r.warnings).toEqual([
      'BASE_SIZE_MISSING_FRACTION: 1 of 3 lines have no fraction',
      'BASE_SIZE_FRACTIONS_SUM: fractions sum to 1/1, leaving nothing for lines without a fraction',
    ]);
  });

  it('rejects invalid counts', () => {
    const s = spec('40mm', [part(round(40))]);
    expect(() => resolveModelBases(s, -1)).toThrow(RangeError);
    expect(() => resolveModelBases(s, 1.5)).toThrow(RangeError);
    expect(() => resolveModelBases(s, 1, { base: -1, actual: 1 })).toThrow(RangeError);
    expect(() => resolveModelBases(s, 1, { base: 1, actual: 0.5 })).toThrow(RangeError);
  });

  it('resolveBases is the ADR 0009 shorthand', () => {
    expect(resolveBases(spec('25mm', [part(round(25))]), 2)).toEqual([round(25), round(25)]);
  });
});
