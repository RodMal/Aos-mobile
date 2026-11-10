import type { BaseShape } from '../schema/base-size.js';
import type { Warscroll } from '../schema/warscroll.js';
import { resolveUnitSize, type UnitSize } from '../size.js';
import { resolveModelBases, siblingBaseModels } from './resolve.js';

/** One model of a warscroll with its resolved base (ADR 0033 §3). */
export interface WarscrollModel {
  base: BaseShape;
  /** True for the group's leading `champions.actual` models (ADR 0009 step 2). */
  champion: boolean;
  /** Index of the model group in `warscroll.models` (data order, not output order). */
  groupIndex: number;
}

/** Result of resolveWarscrollModels. */
export interface WarscrollModels {
  /** Champion groups first (data order otherwise), champions first within each group. */
  models: WarscrollModel[];
  /** Champion models in `models`; they are exactly its first `championCount` entries. */
  championCount: number;
  /** True when at least one model got the 32mm fallback base. */
  fallback: boolean;
  /** BASE_SIZE_* warnings from resolveModelBases, in output group order. */
  warnings: string[];
}

/**
 * Resolve every model of a warscroll to a base, at the base size or reinforced once
 * (ADR 0009, ADR 0032, ADR 0033). `reinforced` is ignored when the unit cannot be
 * reinforced, as in unitModelCount.
 *
 * - Each group resolves `min + perReinforce` models (`min` at the base size); groups that
 *   get 0 models are skipped. Groups holding a champion come first; the rest keep data order.
 * - A champion group resolves with `champions = { base: championCount, actual }`, where
 *   `actual = championCount + championsPerReinforce` when reinforced (ADR 0033 §1), capped
 *   at the group's models. Its first `actual` models are the champions.
 * - Each group gets its ADR 0032 sibling context, so a spec written over the whole unit does
 *   not warn (it never changes the bases).
 *
 * - `size` is a `boolean` (`true` = reinforced, as before) or a UnitSize. At undersize
 *   (ADR 0035) each group resolves `undersize.models[].count` models and champions are not
 *   scaled (`actual = championCount`, capped at the group's models). Undersize plus
 *   reinforced, or undersize without an option, throws a RangeError (resolveUnitSize).
 *
 * At the base size the bases and champion flags are those of ADR 0009 step 2 with fixed
 * numerators. `models` is empty only when every group resolves to 0 models.
 */
export function resolveWarscrollModels(
  warscroll: Pick<Warscroll, 'models' | 'reinforce' | 'undersize'>,
  size: boolean | UnitSize,
): WarscrollModels {
  const s = resolveUnitSize(warscroll, size);
  const times = s.reinforced && warscroll.reinforce.allowed ? 1 : 0;
  const undersizeCount = new Map(
    (s.undersize?.models ?? []).map((m) => [m.modelGroupId, m.count] as const),
  );
  const models: WarscrollModel[] = [];
  const warnings: string[] = [];
  let fallback = false;
  let championCount = 0;
  const order = warscroll.models
    .map((group, index) => ({ group, index }))
    .sort((a, b) => Number(b.group.champion) - Number(a.group.champion) || a.index - b.index);
  for (const { group, index } of order) {
    const count = s.undersize
      ? (undersizeCount.get(group.id) ?? group.min)
      : group.min + group.perReinforce * times;
    if (count === 0) continue;
    const champions = group.champion
      ? {
          base: group.championCount,
          actual: Math.min(count, group.championCount + (group.championsPerReinforce ?? 0) * times),
        }
      : undefined;
    const resolved = resolveModelBases(group.base, count, champions, {
      siblingModels: siblingBaseModels(warscroll.models, index),
    });
    // A champion group whose base string has no "(Champion)" line (The Twistweald's
    // Swarmsage, Questor Soulsworn, Freeguild Grenadiers; ADR 0033 §2) resolves its bases
    // like any other group, since resolveModelBases has no champion part to put first.
    // Its first `actual` models are still flagged as champions here, so only the champion
    // count changes when reinforced, never the bases.
    const leading = champions?.actual ?? 0;
    resolved.bases.forEach((base, i) => {
      models.push({ base, champion: i < leading, groupIndex: index });
    });
    championCount += Math.min(leading, resolved.bases.length);
    warnings.push(...resolved.warnings);
    fallback ||= resolved.fallback;
  }
  return { models, championCount, fallback, warnings };
}
