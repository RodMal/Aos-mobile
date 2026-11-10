import type { Faction } from './schema/faction.js';
import type { UndersizeOption, Warscroll } from './schema/warscroll.js';

/**
 * The size of one unit (ADR 0035 §Shapes to build): regular, reinforced once, or undersize.
 * A plain `boolean` keeps its old meaning (`true` = reinforced).
 */
export interface UnitSize {
  reinforced: boolean;
  undersize?: boolean;
}

/** Normalised size: `undersize` set means the option to use (never reinforced). */
export interface ResolvedUnitSize {
  reinforced: boolean;
  undersize?: UndersizeOption;
}

/**
 * Normalise a `boolean | UnitSize` argument for `warscroll`. Throws a RangeError for
 * `{ reinforced: true, undersize: true }` (an undersize unit can never be reinforced) and
 * for an undersize pick on a warscroll without an `undersize` option; the validator reports
 * both first (REINFORCE_NOT_ALLOWED, UNDERSIZE_NOT_AVAILABLE).
 */
export function resolveUnitSize(
  warscroll: Pick<Warscroll, 'undersize'> & { name?: string },
  size: boolean | UnitSize,
): ResolvedUnitSize {
  if (typeof size === 'boolean') return { reinforced: size };
  if (size.undersize !== true) return { reinforced: size.reinforced };
  const label = warscroll.name ?? 'this warscroll';
  if (size.reinforced) {
    throw new RangeError(`${label}: an undersize unit cannot be reinforced`);
  }
  if (!warscroll.undersize) throw new RangeError(`${label} has no undersize option`);
  return { reinforced: false, undersize: warscroll.undersize };
}

const companionCache = new WeakMap<Pick<Faction, 'warscrolls'>, ReadonlySet<string>>();

/**
 * Warscroll ids that come with a parent and cannot be picked on their own (ADR 0037 §2):
 * every `companions[].warscrollId` in the faction. Pure, memoised per faction object.
 */
export function companionWarscrollIds(faction: Pick<Faction, 'warscrolls'>): ReadonlySet<string> {
  let ids = companionCache.get(faction);
  if (!ids) {
    ids = new Set(
      faction.warscrolls.flatMap((w) => (w.companions ?? []).map((c) => c.warscrollId)),
    );
    companionCache.set(faction, ids);
  }
  return ids;
}
