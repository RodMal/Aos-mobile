import { describe, expect, it } from 'vitest';
import {
  BaseSizeSpecSchema,
  type BaseShape,
  type BaseSizePart,
  type BaseSizeSpec,
} from '../schema/base-size.js';
import type { ModelGroup, Warscroll } from '../schema/warscroll.js';
import { resolveModelBases, siblingBaseModels } from './resolve.js';
import { resolveWarscrollModels } from './warscroll-models.js';

/** ADR 0033 §2 and §6: shared champion lines split into champions and an ordinary share. */

const round = (diameterMm: number): BaseShape => ({ kind: 'round', diameterMm });
const oval = (lengthMm: number, widthMm: number): BaseShape => ({
  kind: 'oval',
  lengthMm,
  widthMm,
});

function part(shape: BaseShape, frac?: [number, number], champion = false): BaseSizePart {
  const p: BaseSizePart = { shape, alternatives: [], champion };
  if (frac) p.fraction = { num: frac[0], den: frac[1] };
  if (champion) p.note = 'Champion';
  return p;
}

function spec(raw: string, parts: BaseSizePart[]): BaseSizeSpec {
  return BaseSizeSpecSchema.parse({ raw, parts, source: 'data', warnings: [] });
}

const label = (b: BaseShape): string =>
  b.kind === 'round'
    ? `${b.diameterMm}`
    : b.kind === 'oval' || b.kind === 'rect'
      ? `${b.lengthMm}x${b.widthMm}`
      : 'useModel';

/** Run-length summary in output order, e.g. ['2x40', '8x32']. */
function runs(bases: readonly BaseShape[]): string[] {
  const out: [string, number][] = [];
  for (const b of bases) {
    const l = label(b);
    const last = out[out.length - 1];
    if (last?.[0] === l) last[1] += 1;
    else out.push([l, 1]);
  }
  return out.map(([l, n]) => `${n}x${l}`);
}

const LEGIONNAIRES = spec('5/8 32mm (Champion)\n3/8 28.5mm', [
  part(round(32), [5, 8], true),
  part(round(28.5), [3, 8]),
]);
const RIVERBLADES = spec('5/10 32mm (Champion)\n5/10 28.5mm', [
  part(round(32), [5, 10], true),
  part(round(28.5), [5, 10]),
]);
const BOLAS = spec('2/5 28.5mm (Champion, Hunter Javelin)\n3/5 25mm', [
  part(round(28.5), [2, 5], true),
  part(round(25), [3, 5]),
]);
const IRON_GOLEM = spec('3/8 32mm (Champion)\n4/8 28.5mm', [
  part(round(32), [3, 8], true),
  part(round(28.5), [4, 8]),
]);
const CLAWS = spec('1/8 40mm (Champion)\n1/8 60x35mm\n2/8 32mm\n4/8 28.5mm', [
  part(round(40), [1, 8], true),
  part(oval(60, 35), [1, 8]),
  part(round(32), [2, 8]),
  part(round(28.5), [4, 8]),
]);
const PYREGHEISTS = spec('1/8 40mm (Champion)\n4/8 32mm\n3/8 28.5mm', [
  part(round(40), [1, 8], true),
  part(round(32), [4, 8]),
  part(round(28.5), [3, 8]),
]);
const RAPTORS = spec('60x35mm\n40mm (Champion)', [
  part(oval(60, 35)),
  part(round(40), undefined, true),
]);

describe('resolveModelBases with champions (ADR 0033 §2)', () => {
  it('Chaos Legionnaires: 8 reproduces 5/3; 16 gives 10 x 32mm (2 champions) + 6 x 28.5mm', () => {
    const box = resolveModelBases(LEGIONNAIRES, 8, { base: 1, actual: 1 });
    expect(runs(box.bases)).toEqual(['5x32', '3x28.5']);
    expect(box.bases).toEqual(resolveModelBases(LEGIONNAIRES, 8).bases);
    expect(box.warnings).toEqual([]);
    const two = resolveModelBases(LEGIONNAIRES, 16, { base: 1, actual: 2 });
    expect(runs(two.bases)).toEqual(['10x32', '6x28.5']);
    expect(two.warnings).toEqual([]);
  });

  it('Ydrilan Riverblades 20: 10 + 10', () => {
    const r = resolveModelBases(RIVERBLADES, 20, { base: 1, actual: 2 });
    expect(runs(r.bases)).toEqual(['10x32', '10x28.5']);
  });

  it('Hunters with Starstone Bolas 10: 4 x 28.5mm + 6 x 25mm', () => {
    const r = resolveModelBases(BOLAS, 10, { base: 1, actual: 2 });
    expect(runs(r.bases)).toEqual(['4x28.5', '6x25']);
  });

  it('Iron Golem 14 in a 16-model unit (whole-unit spec): 6 x 32mm + 8 x 28.5mm, no sum warning', () => {
    const r = resolveModelBases(IRON_GOLEM, 14, { base: 1, actual: 2 }, { siblingModels: 1 });
    expect(runs(r.bases)).toEqual(['6x32', '8x28.5']);
    expect(r.warnings).toEqual([]);
    // Base size: 7 golems, 3 on 32mm.
    const box = resolveModelBases(IRON_GOLEM, 7, { base: 1, actual: 1 }, { siblingModels: 1 });
    expect(runs(box.bases)).toEqual(['3x32', '4x28.5']);
  });

  it('Claws of Karanak 16: 2 x 40mm champions', () => {
    const r = resolveModelBases(CLAWS, 16, { base: 1, actual: 2 });
    expect(runs(r.bases)).toEqual(['2x40', '2x60x35', '4x32', '8x28.5']);
  });

  it('Pyregheists 16 (plain CHAMPION): one 40mm, the same as without champions', () => {
    const r = resolveModelBases(PYREGHEISTS, 16, { base: 1, actual: 1 });
    expect(runs(r.bases)).toEqual(['1x40', '9x32', '6x28.5']);
    expect(r.bases).toEqual(resolveModelBases(PYREGHEISTS, 16).bases);
  });

  it('a champion line without a fraction has no shared part (Vanguard-Raptors)', () => {
    expect(runs(resolveModelBases(RAPTORS, 3, { base: 1, actual: 1 }).bases)).toEqual([
      '1x40',
      '2x60x35',
    ]);
    expect(runs(resolveModelBases(RAPTORS, 6, { base: 1, actual: 1 }).bases)).toEqual([
      '1x40',
      '5x60x35',
    ]);
  });

  it('warns when champions.base exceeds the champion lines total', () => {
    const r = resolveModelBases(PYREGHEISTS, 8, { base: 2, actual: 2 });
    expect(r.warnings.some((w) => w.startsWith('BASE_SIZE_CHAMPION_COUNT'))).toBe(true);
    expect(resolveModelBases(LEGIONNAIRES, 8, { base: 5, actual: 5 }).warnings).toEqual([]);
  });

  it('caps champions at the model count', () => {
    expect(runs(resolveModelBases(LEGIONNAIRES, 1, { base: 1, actual: 2 }).bases)).toEqual([
      '1x32',
    ]);
  });
});

function group(over: Partial<ModelGroup> & Pick<ModelGroup, 'base'>): ModelGroup {
  return {
    id: over.name ?? 'g',
    name: 'g',
    min: 1,
    max: 1,
    perReinforce: 0,
    champion: false,
    championCount: 0,
    ...over,
  };
}

const warscroll = (
  models: ModelGroup[],
  allowed = true,
): Pick<Warscroll, 'models' | 'reinforce'> => ({
  models,
  reinforce: { allowed, maxTimes: allowed ? 1 : 0, pointsMultiplier: allowed ? 2 : 1 },
});

describe('resolveWarscrollModels (ADR 0033 §3)', () => {
  const legionnaires = warscroll([
    group({
      name: 'Chaos Legionnaires',
      min: 8,
      max: 8,
      perReinforce: 8,
      championsPerReinforce: 1,
      champion: true,
      championCount: 1,
      base: LEGIONNAIRES,
    }),
  ]);

  it('reinforced Chaos Legionnaires: 16 models, the first 2 are champions', () => {
    const r = resolveWarscrollModels(legionnaires, true);
    expect(runs(r.models.map((m) => m.base))).toEqual(['10x32', '6x28.5']);
    expect(r.models.map((m) => m.champion)).toEqual([true, true, ...Array(14).fill(false)]);
    expect(r.championCount).toBe(2);
    expect(r.models.every((m) => m.groupIndex === 0)).toBe(true);
  });

  it('base size: 5/3 with one champion; reinforced is ignored when not allowed', () => {
    const base = resolveWarscrollModels(legionnaires, false);
    expect(runs(base.models.map((m) => m.base))).toEqual(['5x32', '3x28.5']);
    expect(base.championCount).toBe(1);
    const notAllowed = resolveWarscrollModels(
      { ...legionnaires, reinforce: { allowed: false, maxTimes: 0, pointsMultiplier: 1 } },
      true,
    );
    expect(notAllowed).toEqual(base);
  });

  it('puts champion groups first, keeps groupIndex in data order and the ADR 0032 context', () => {
    const golem = warscroll([
      group({
        name: 'Ogor Breacher',
        min: 1,
        max: 1,
        perReinforce: 1,
        base: spec('40mm', [part(round(40))]),
      }),
      group({
        name: 'Iron Golem',
        min: 7,
        max: 7,
        perReinforce: 7,
        championsPerReinforce: 1,
        champion: true,
        championCount: 1,
        base: IRON_GOLEM,
      }),
    ]);
    const r = resolveWarscrollModels(golem, true);
    expect(runs(r.models.map((m) => m.base))).toEqual(['6x32', '8x28.5', '2x40']);
    expect(r.models.map((m) => m.groupIndex)).toEqual([...Array(14).fill(1), 0, 0]);
    expect(r.championCount).toBe(2);
    expect(r.warnings).toEqual([]);
    expect(siblingBaseModels(golem.models, 1)).toBe(1);
  });

  it('skips groups with 0 models', () => {
    const r = resolveWarscrollModels(
      warscroll([group({ min: 0, max: 1, base: spec('25mm', [part(round(25))]) })]),
      false,
    );
    expect(r).toEqual({ models: [], championCount: 0, fallback: false, warnings: [] });
  });
});
