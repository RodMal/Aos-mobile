import {
  BASE_SIZE_CODES,
  FALLBACK_BASE,
  type BaseShape,
  type BaseSizePart,
  type BaseSizeSpec,
} from '../schema/base-size.js';

/** Result of resolving a BaseSizeSpec to one base per model. */
export interface ResolvedBases {
  /** One base per model: champion bases first, then the other parts in line order. */
  bases: BaseShape[];
  /** True when at least one model got the 32mm fallback base. */
  fallback: boolean;
  /** Warning strings prefixed with a stable code (see BASE_SIZE_CODES). */
  warnings: string[];
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * Unit context for the fraction check (ADR 0032 §1, §4): the models of the unit's OTHER model
 * groups that carry their own Base Size rule, at the base unit size (not Reinforced).
 */
export interface FractionUnitContext {
  siblingModels: number;
}

/**
 * True when a spec's fractions are written over the whole unit (ADR 0032 §1): every line has
 * a fraction, all share one denominator D, the numerators sum to S < D, and S plus the
 * sibling model count equals D. Example: Vulkyn Flameseeker `2/9 32mm\n5/9 28.5mm` (S = 7)
 * next to a Runefather and a Kyndledroth (2 siblings) = 9.
 */
export function isWholeUnitFraction(
  parts: readonly BaseSizePart[],
  unit: FractionUnitContext,
): boolean {
  if (parts.length === 0) return false;
  const fractions = parts.map((p) => p.fraction);
  if (fractions.some((f) => f === undefined)) return false;
  const dens = new Set(fractions.map((f) => f?.den));
  if (dens.size !== 1) return false;
  const den = fractions[0]?.den ?? 0;
  const sum = fractions.reduce((s, f) => s + (f?.num ?? 0), 0);
  return sum < den && sum + unit.siblingModels === den;
}

/**
 * Models in the other groups of `groups` (by index) that carry their own Base Size rule, at
 * the base unit size: the `siblingModels` of FractionUnitContext (ADR 0032 §1). A group whose
 * spec is the "no Base Size rule" fallback (source "fallback", empty raw) does not count.
 */
export function siblingBaseModels(
  groups: readonly { min: number; base: BaseSizeSpec }[],
  index: number,
): number {
  return groups.reduce(
    (n, g, i) =>
      i === index || (g.base.source === 'fallback' && g.base.raw === '') ? n : n + g.min,
    0,
  );
}

/**
 * Data-level warnings about the fractions of a spec (ADR 0009): fractions that do not sum
 * to 1, mixed denominators, and lines without a fraction next to lines with one. When some
 * lines lack a fraction, the sum check instead warns if the given fractions reach 1 or
 * more, because the lines without one would then get no models. Shared by
 * the parser (spec.warnings) and by resolution.
 *
 * With `unit` context, a spec written over the whole unit (isWholeUnitFraction, ADR 0032)
 * does not get BASE_SIZE_FRACTIONS_SUM. Without it the ADR 0009 behaviour is kept (ADR 0032
 * §4). The other warnings never depend on the context.
 */
export function fractionWarnings(
  parts: readonly BaseSizePart[],
  unit?: FractionUnitContext,
): string[] {
  const withFraction = parts.filter((p) => p.fraction !== undefined);
  if (withFraction.length === 0) return [];
  const warnings: string[] = [];
  const dens = [...new Set(withFraction.map((p) => p.fraction?.den ?? 1))];
  if (dens.length > 1) {
    warnings.push(
      `${BASE_SIZE_CODES.mixedDenominators}: denominators ${dens.join(', ')} are mixed`,
    );
  }
  const missing = parts.length - withFraction.length;
  if (missing > 0) {
    warnings.push(
      `${BASE_SIZE_CODES.missingFraction}: ${missing} of ${parts.length} lines have no fraction`,
    );
  }
  const common = dens.reduce(lcm, 1);
  const total = withFraction.reduce(
    (sum, p) => sum + (p.fraction?.num ?? 0) * (common / (p.fraction?.den ?? 1)),
    0,
  );
  const g = gcd(total, common);
  const sum = `${total / g}/${common / g}`;
  if (missing === 0 && total !== common) {
    // ADR 0032 §2: no sum warning when the siblings fill the rest of the denominator.
    if (unit !== undefined && isWholeUnitFraction(parts, unit)) return warnings;
    warnings.push(`${BASE_SIZE_CODES.fractionsSum}: fractions sum to ${sum}, not 1`);
  } else if (missing > 0 && total >= common) {
    // Lines without a fraction share 1 - sum; at 1 or more they would get no models.
    warnings.push(
      `${BASE_SIZE_CODES.fractionsSum}: fractions sum to ${sum}, leaving nothing for lines without a fraction`,
    );
  }
  return warnings;
}

/**
 * Largest-remainder allocation of `total` items over integer `weights` (ADR 0009 step 3).
 * Each index gets floor(w * total / sum); the leftover goes one by one to the largest
 * remainders, ties broken by index order. All arithmetic is integer, so it is exact.
 * If every weight is 0 the weights are treated as equal.
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.every((x) => x <= 0)
    ? weights.map(() => 1)
    : weights.map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  const counts = w.map((x) => Math.floor((x * total) / sum));
  const remainders = w.map((x, i) => x * total - (counts[i] ?? 0) * sum);
  let leftover = total - counts.reduce((a, b) => a + b, 0);
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.i);
  for (let k = 0; leftover > 0; k = (k + 1) % order.length) {
    const i = order[k] ?? 0;
    counts[i] = (counts[i] ?? 0) + 1;
    leftover -= 1;
  }
  return counts;
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Champion models of a group for resolution (ADR 0033 §2, §3): `base` is the champion count
 * at the base unit size (c₀, `ModelGroup.championCount`), `actual` the count at the size
 * being resolved (c, e.g. `championCount + championsPerReinforce` when reinforced).
 */
export interface ChampionCounts {
  base: number;
  actual: number;
}

/**
 * Resolve a BaseSizeSpec to one base per model (ADR 0009 "Per-model resolution", ADR 0033).
 *
 * 1. A single part without a fraction applies to every model.
 * 2. Champion parts come first. Without `champions`, each has a fixed count equal to its
 *    numerator (1 if it has no fraction), capped at the model count (ADR 0009). With
 *    `champions` (ADR 0033 §2), a champion line with numerator `num` splits into a champion
 *    part of `champions.actual` models (spread over the champion lines by their numerators,
 *    capped at the model count) and a shared part of weight `(num − champions.base)/den`.
 *    The shared part is resolved with the other parts in step 3 and placed straight after
 *    the champion bases; it is empty when `num ≤ champions.base` or the line has no
 *    fraction. At the base size this reproduces the spec exactly. BASE_SIZE_CHAMPION_COUNT
 *    is added when `champions.base` exceeds the champion lines' total.
 * 3. The remaining models are split over the shared and the other parts by largest
 *    remainder. A part without a fraction weighs 1 minus the sum of all fractions (min 0,
 *    shared equally by such parts); if no part has a fraction, weights are equal.
 * 4. `useModel` shapes and unparsed specs (no parts) resolve to the 32mm fallback, with a
 *    warning and `fallback: true`.
 *
 * `unit` is the optional ADR 0032 context for the fraction warnings (see fractionWarnings);
 * pass `{ siblingModels: siblingBaseModels(warscroll.models, i) }` for group `i` so a spec
 * written over the whole unit does not warn. It never changes the bases (ADR 0032 §3).
 * resolveWarscrollModels passes both for every group of a warscroll.
 */
export function resolveModelBases(
  spec: BaseSizeSpec,
  modelCount: number,
  champions?: ChampionCounts,
  unit?: FractionUnitContext,
): ResolvedBases {
  assertCount('modelCount', modelCount);
  if (champions !== undefined) {
    assertCount('champions.base', champions.base);
    assertCount('champions.actual', champions.actual);
  }

  const warnings: string[] = [];
  let fallback = false;
  const usable = (shape: BaseShape): BaseShape => {
    if (shape.kind !== 'useModel') return shape;
    if (!fallback) {
      warnings.push(
        `${BASE_SIZE_CODES.fallback}: "${spec.raw}" says "Use model"; using a ${FALLBACK_BASE.diameterMm}mm round base`,
      );
    }
    fallback = true;
    return { ...FALLBACK_BASE };
  };

  const { parts } = spec;
  if (parts.length === 0) {
    if (modelCount > 0) {
      warnings.push(
        `${BASE_SIZE_CODES.fallback}: no usable base size in "${spec.raw}"; using a ${FALLBACK_BASE.diameterMm}mm round base`,
      );
    }
    return {
      bases: Array.from({ length: modelCount }, () => ({ ...FALLBACK_BASE })),
      fallback: modelCount > 0,
      warnings,
    };
  }

  const repeat = (shape: BaseShape, count: number): BaseShape[] => {
    // A part that gets no models must not mark the result as a fallback.
    if (count <= 0) return [];
    const s = usable(shape);
    return Array.from({ length: count }, () => ({ ...s }));
  };

  const [only] = parts;
  if (parts.length === 1 && only !== undefined && only.fraction === undefined) {
    const bases = modelCount > 0 ? repeat(only.shape, modelCount) : [];
    return { bases, fallback, warnings };
  }

  warnings.push(...fractionWarnings(parts, unit));

  const championParts = parts.filter((p) => p.champion);
  const otherParts = parts.filter((p) => !p.champion);
  const common = parts.reduce((acc, p) => (p.fraction ? lcm(acc, p.fraction.den) : acc), 1);
  const scaled = (p: BaseSizePart): number =>
    p.fraction ? p.fraction.num * (common / p.fraction.den) : 0;
  const noFraction = otherParts.filter((p) => p.fraction === undefined).length;
  const k = Math.max(1, noFraction);

  // Step 2: champion counts, and (ADR 0033 §2) the ordinary share of each champion line.
  const defaults = championParts.map((p) => p.fraction?.num ?? 1);
  let championCounts: number[];
  /** Shared parts of the champion lines, weighted like the other parts (times k). */
  let shared: { shape: BaseShape; weight: number }[] = [];
  if (champions !== undefined && championParts.length > 0) {
    const specTotal = defaults.reduce((a, b) => a + b, 0);
    if (champions.base > specTotal) {
      warnings.push(
        `${BASE_SIZE_CODES.championCount}: unit has ${champions.base} champion model(s) but "${spec.raw}" implies ${specTotal}`,
      );
    }
    const atBase = largestRemainder(champions.base, defaults);
    championCounts = largestRemainder(Math.min(champions.actual, modelCount), defaults);
    shared = championParts
      .map((p, i) => ({
        shape: p.shape,
        weight: p.fraction
          ? Math.max(0, p.fraction.num - (atBase[i] ?? 0)) * (common / p.fraction.den) * k
          : 0,
      }))
      .filter((s) => s.weight > 0);
  } else {
    let remaining = modelCount;
    championCounts = defaults.map((d) => {
      const take = Math.min(d, remaining);
      remaining -= take;
      return take;
    });
  }
  const championTotal = championCounts.reduce((a, b) => a + b, 0);
  const rest = modelCount - championTotal;

  // Step 3: largest remainder over the shared champion-line parts and the other parts.
  const fractionTotal = parts.reduce((sum, p) => sum + scaled(p), 0);
  const items = [
    ...shared,
    ...otherParts.map((p) => ({
      shape: p.shape,
      weight: p.fraction ? scaled(p) * k : Math.max(0, common - fractionTotal),
    })),
  ];
  let itemCounts: number[] = [];
  if (items.length > 0) {
    itemCounts = largestRemainder(
      rest,
      items.map((x) => x.weight),
    );
  } else if (rest > 0) {
    const lastIndex = championCounts.length - 1;
    warnings.push(
      `${BASE_SIZE_CODES.championOverflow}: "${spec.raw}" has only champion lines; ${rest} more model(s) use the last champion base`,
    );
    championCounts[lastIndex] = (championCounts[lastIndex] ?? 0) + rest;
  }

  const bases: BaseShape[] = [];
  championParts.forEach((p, i) => bases.push(...repeat(p.shape, championCounts[i] ?? 0)));
  items.forEach((x, i) => bases.push(...repeat(x.shape, itemCounts[i] ?? 0)));
  return { bases, fallback, warnings };
}

/** ADR 0009 signature: one base per model, without the warnings. */
export function resolveBases(spec: BaseSizeSpec, modelCount: number): BaseShape[] {
  return resolveModelBases(spec, modelCount).bases;
}
