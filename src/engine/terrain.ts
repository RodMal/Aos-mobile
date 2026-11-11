/**
 * Terrain, Line of Sight (Obscuring), Cover, Unstable, Guarded Hero, Terrain Control,
 * and Place of Power (GHB 2026-27 Terrain 1.1-1.4 & Core Rules 25.0).
 */
import type { TerrainFeature } from '../data/battlefield.js';
import {
  footprintDistanceToPolygon,
  footprintInsidePolygon,
  footprintOverlapsPolygon,
  footprintsOverlap,
  pointInPolygon,
  segmentsIntersect,
  type Footprint,
  type Polygon,
  type ReadonlyPoint,
} from '../geom/index.js';
import { addEffect, hasEffectiveKeyword } from './abilities/effects.js';
import { illegal, type Ctx } from './ctx.js';
import { allocateDamage } from './damage.js';
import {
  aliveCount,
  aliveIndices,
  COMBAT_RANGE,
  DIST_EPS,
  inCombat,
  modelFootprint,
  profileOf,
  unitBounds,
  unitCentre,
  unitFootprints,
  unitsOf,
  unitsWithin,
} from './query.js';
import type { AttackMode, GameState, Placement, PlayerId, Scenario, UnitState } from './types.js';

/** Step size in inches when sampling straight-line movement paths. */
const PATH_STEP = 0.5;

/** Distance within which a unit is sheltered by Obscuring terrain or Cover. */
export const OBSCURING_RANGE = 1;
export const COVER_WHOLLY_WITHIN_RANGE = 1;
export const COVER_BEHIND_RANGE = 3;
export const GUARDED_HERO_RANGE = 3;
export const TERRAIN_CONTROL_RANGE = 3;
export const PLACE_OF_POWER_RANGE = 3;
export const PLACE_OF_POWER_ID = 'place-of-power';

export type PlaceOfPowerBoon = 'ignite_fury' | 'channelled_wrath' | 'dizzying_rage';

// ─── 1. Terrain distance & overlap helpers ─────────────────────────────────────

/**
 * True when `fp` overlaps `terrain.polygon` (`range === 0`) or is within `range` inches
 * of `terrain.polygon`.
 */
export function footprintWithinTerrain(
  fp: Footprint,
  terrain: TerrainFeature,
  range: number,
): boolean {
  if (footprintOverlapsPolygon(fp, terrain.polygon)) return true;
  if (range <= 0) return false;
  return footprintDistanceToPolygon(fp, terrain.polygon) <= range + DIST_EPS;
}

/**
 * True when any (or every, if `wholly` is true) living model footprint of `unit` is within
 * `range` inches of `terrain.polygon`.
 */
export function unitWithinTerrain(
  scenario: Scenario,
  unit: UnitState,
  terrain: TerrainFeature,
  range: number,
  wholly = false,
): boolean {
  const fps = unitFootprints(scenario, unit);
  if (fps.length === 0) return false;
  return wholly
    ? fps.every((fp) => footprintWithinTerrain(fp, terrain, range))
    : fps.some((fp) => footprintWithinTerrain(fp, terrain, range));
}

/** True when every living model of `unit` lies wholly inside `terrain.polygon`. */
export function unitWhollyOnTerrain(
  scenario: Scenario,
  unit: UnitState,
  terrain: TerrainFeature,
): boolean {
  const fps = unitFootprints(scenario, unit);
  if (fps.length === 0) return false;
  return fps.every((fp) => footprintInsidePolygon(fp, terrain.polygon));
}

// ─── 2. Unstable terrain ('unstable' trait, e.g. ruin) ─────────────────────────

/**
 * Sorted array of model indices `m.i` in `placement.models` whose placed footprint overlaps
 * any `'unstable'` terrain feature. Models can move across unstable terrain, but cannot be
 * set up on or end any move on it.
 */
export function unstableTerrainViolations(
  scenario: Scenario,
  unit: UnitState,
  placement: Placement,
): number[] {
  const unstable = scenario.battlefield.terrain.filter((t) => t.traits.includes('unstable'));
  if (unstable.length === 0) return [];
  const out: number[] = [];
  for (const m of placement.models) {
    const fp = modelFootprint(scenario, unit, m.i, m);
    if (unstable.some((t) => footprintOverlapsPolygon(fp, t.polygon))) {
      out.push(m.i);
    }
  }
  return out.sort((a, b) => a - b);
}

// ─── 3. Fly & Path-blocking ────────────────────────────────────────────────────

/**
 * Sorted array of model indices whose straight-line path from their current position to
 * `placement` passes across another unit's model on the battlefield.
 * Units with `FLY` ignore other models along their path. Unstable terrain permits crossing
 * and only blocks ending positions (checked via `unstableTerrainViolations`).
 */
export function pathBlockedModels(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  placement: Placement,
): number[] {
  if (hasEffectiveKeyword(scenario, state, unit, 'FLY')) return [];

  const otherFootprints: Footprint[] = [];
  const own = unitBounds(scenario, unit);
  let maxMove = 0;
  for (const m of placement.models) {
    const from = unit.models[m.i];
    if (!from) continue;
    maxMove = Math.max(maxMove, Math.hypot(m.x - from.x, m.y - from.y));
  }

  for (const id of state.unitOrder) {
    const other = state.units[id]!;
    if (other.id === unit.id || other.status !== 'battlefield') continue;
    const b = unitBounds(scenario, other);
    if (Math.hypot(b.x - own.x, b.y - own.y) - b.r - own.r > maxMove + 2) continue;
    otherFootprints.push(...unitFootprints(scenario, other));
  }

  if (otherFootprints.length === 0) return [];

  const blocked: number[] = [];
  for (const m of placement.models) {
    const from = unit.models[m.i];
    if (!from) continue;
    const dist = Math.hypot(m.x - from.x, m.y - from.y);
    const steps = Math.ceil(dist / PATH_STEP);
    for (let s = 1; s < steps; s++) {
      const f = (s * PATH_STEP) / dist;
      const at = {
        x: from.x + (m.x - from.x) * f,
        y: from.y + (m.y - from.y) * f,
        rot: m.rot,
      };
      const fp = modelFootprint(scenario, unit, m.i, at);
      if (otherFootprints.some((otherFp) => footprintsOverlap(fp, otherFp))) {
        blocked.push(m.i);
        break;
      }
    }
  }
  return blocked.sort((a, b) => a - b);
}

export const checkPathBlocked = pathBlockedModels;

// ─── 4. Line of Sight & Obscuring Terrain ('obscuring' trait) ──────────────────

/** True when the straight line segment from `a` to `b` intersects or passes through `poly`. */
export function segmentCrossesPolygon(a: ReadonlyPoint, b: ReadonlyPoint, poly: Polygon): boolean {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i]!;
    const d = poly[(i + 1) % poly.length]!;
    if (segmentsIntersect(a, b, c, d)) return true;
  }
  const mid: ReadonlyPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return pointInPolygon(a, poly) || pointInPolygon(b, poly) || pointInPolygon(mid, poly);
}

/**
 * True when `unit` is sheltered by an `'obscuring'` terrain feature: every living model is
 * within 1" of that feature, and the unit does not have `MONSTER`, `WAR MACHINE`, or `FLY`.
 */
export function isUnitObscured(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (
    hasEffectiveKeyword(scenario, state, unit, 'MONSTER') ||
    hasEffectiveKeyword(scenario, state, unit, 'WAR MACHINE') ||
    hasEffectiveKeyword(scenario, state, unit, 'FLY')
  ) {
    return false;
  }
  return scenario.battlefield.terrain.some(
    (t) =>
      t.traits.includes('obscuring') && unitWithinTerrain(scenario, unit, t, OBSCURING_RANGE, true),
  );
}

/**
 * Effective range of a ranged weapon for `unit`: halved (rounded down) while `unit` is
 * sheltered by Obscuring terrain (Terrain 2026-27 1.2).
 */
export function effectiveWeaponRange(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  printedRange: number,
): number {
  return isUnitObscured(scenario, state, unit) ? Math.floor(printedRange / 2) : printedRange;
}

/**
 * True when `attackerModelIdx` of `attacker` can see `targetModelIdx` of `target`.
 * - `MONSTER`, `WAR MACHINE`, and `FLY` targets are never hidden by Obscuring terrain.
 * - Enemy units within combat range (3") of `target` can always see it.
 * - Otherwise, a target wholly within 1" of an `'obscuring'` feature, or with the sight
 *   line between the models crossing an `'obscuring'` polygon (that neither model overlaps),
 *   is not visible.
 */
export function isModelVisibleToModel(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  attackerModelIdx: number,
  target: UnitState,
  targetModelIdx: number,
): boolean {
  const aPos = attacker.models[attackerModelIdx];
  const tPos = target.models[targetModelIdx];
  if (!aPos?.alive || !tPos?.alive) return false;

  if (
    hasEffectiveKeyword(scenario, state, target, 'MONSTER') ||
    hasEffectiveKeyword(scenario, state, target, 'WAR MACHINE') ||
    hasEffectiveKeyword(scenario, state, target, 'FLY')
  ) {
    return true;
  }

  if (unitsWithin(scenario, attacker, target, COMBAT_RANGE)) {
    return true;
  }

  const aFp = modelFootprint(scenario, attacker, attackerModelIdx);
  const tFp = modelFootprint(scenario, target, targetModelIdx);
  const aPt: ReadonlyPoint = [aPos.x, aPos.y];
  const tPt: ReadonlyPoint = [tPos.x, tPos.y];

  for (const t of scenario.battlefield.terrain) {
    if (!t.traits.includes('obscuring')) continue;
    if (unitWithinTerrain(scenario, target, t, OBSCURING_RANGE, true)) {
      return false;
    }
    if (
      !footprintOverlapsPolygon(aFp, t.polygon) &&
      !footprintOverlapsPolygon(tFp, t.polygon) &&
      segmentCrossesPolygon(aPt, tPt, t.polygon)
    ) {
      return false;
    }
  }
  return true;
}

/** True when `attackerModelIdx` has visibility to at least one living model of `target`. */
export function isModelVisibleToUnit(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  attackerModelIdx: number,
  target: UnitState,
): boolean {
  return aliveIndices(target).some((ti) =>
    isModelVisibleToModel(scenario, state, attacker, attackerModelIdx, target, ti),
  );
}

/** True when at least one living model of `source` has visibility to at least one living model of `target`. */
export function isUnitVisible(
  scenario: Scenario,
  state: GameState,
  source: UnitState,
  target: UnitState,
): boolean {
  return aliveIndices(source).some((si) =>
    isModelVisibleToUnit(scenario, state, source, si, target),
  );
}

// ─── 5. Cover ('cover' trait, e.g. ruin, outcrop) ──────────────────────────────

function advancePoint(from: ReadonlyPoint, to: ReadonlyPoint, inches: number): ReadonlyPoint {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (d <= inches) return to;
  const f = inches / d;
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
}

/**
 * True when every sight line from `attacker`'s living models to `target`'s living models
 * (discounting the 3" combat range around the attacker) crosses `terrain.polygon`
 * (Terrain 2026-27 1.1).
 */
export function unitBehindTerrain(
  scenario: Scenario,
  attacker: UnitState,
  target: UnitState,
  terrain: TerrainFeature,
): boolean {
  if (terrain.polygon.length < 3) return false;
  const aIndices = aliveIndices(attacker);
  const tIndices = aliveIndices(target);
  if (aIndices.length === 0 || tIndices.length === 0) return false;
  if (unitsWithin(scenario, attacker, target, COMBAT_RANGE)) return false;

  return aIndices.every((ai) => {
    const am = attacker.models[ai]!;
    const from: ReadonlyPoint = [am.x, am.y];
    return tIndices.every((ti) => {
      const tm = target.models[ti]!;
      const to: ReadonlyPoint = [tm.x, tm.y];
      const start = advancePoint(from, to, COMBAT_RANGE);
      return segmentCrossesPolygon(start, to, terrain.polygon);
    });
  });
}

/**
 * True when `target` receives Cover (-1 to hit) against an attack from `attacker`.
 * A unit that charged this turn or has `FLY` never gets Cover.
 */
export function unitHasCover(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  target: UnitState,
  mode: AttackMode = 'shoot',
): boolean {
  if (target.charged) return false;
  if (hasEffectiveKeyword(scenario, state, target, 'FLY')) return false;

  const ac = unitCentre(attacker);
  const tc = unitCentre(target);
  const aPt: ReadonlyPoint = [ac.x, ac.y];
  const tPt: ReadonlyPoint = [tc.x, tc.y];

  for (const t of scenario.battlefield.terrain) {
    if (!t.traits.includes('cover')) continue;
    if (
      unitWhollyOnTerrain(scenario, target, t) ||
      unitWithinTerrain(scenario, target, t, COVER_WHOLLY_WITHIN_RANGE, true)
    ) {
      return true;
    }
    if (mode === 'shoot') {
      if (unitBehindTerrain(scenario, attacker, target, t)) return true;
      if (
        unitWithinTerrain(scenario, target, t, COVER_BEHIND_RANGE, false) &&
        segmentCrossesPolygon(aPt, tPt, t.polygon)
      ) {
        return true;
      }
    }
  }
  return false;
}

// ─── 6. Guarded Hero (Core Rules 25.0) ─────────────────────────────────────────

/**
 * Checks whether `target` is a Guarded Hero (Core Rules 25.0):
 * - Has `HERO`, does not have `MONSTER` or `WAR MACHINE`, and has Health <= 10.
 * - Within 3" of a friendly non-`HERO`, non-manifestation unit with at least 3 living models.
 * Returns `{ guarded, infantry }` (`infantry` is true when the guarded Hero also has `INFANTRY`,
 * limiting ranged attacks to targets within 12").
 */
export function isGuardedHero(
  scenario: Scenario,
  state: GameState,
  target: UnitState,
): { guarded: boolean; infantry: boolean } {
  if (target.status !== 'battlefield') return { guarded: false, infantry: false };
  if (!hasEffectiveKeyword(scenario, state, target, 'HERO')) {
    return { guarded: false, infantry: false };
  }
  if (
    hasEffectiveKeyword(scenario, state, target, 'MONSTER') ||
    hasEffectiveKeyword(scenario, state, target, 'WAR MACHINE')
  ) {
    return { guarded: false, infantry: false };
  }
  const tp = profileOf(scenario, target);
  if (tp.health > 10) return { guarded: false, infantry: false };

  const hasBodyguard = unitsOf(state, target.owner).some((other) => {
    if (other.id === target.id) return false;
    if (other.isManifestation) return false;
    const op = profileOf(scenario, other);
    if (op.isManifestation || op.isFactionTerrain) return false;
    if (hasEffectiveKeyword(scenario, state, other, 'HERO')) return false;
    if (aliveCount(other) < 3) return false;
    return unitsWithin(scenario, target, other, GUARDED_HERO_RANGE);
  });

  if (!hasBodyguard) return { guarded: false, infantry: false };
  return {
    guarded: true,
    infantry: hasEffectiveKeyword(scenario, state, target, 'INFANTRY'),
  };
}

// ─── 7. Terrain Control ────────────────────────────────────────────────────────

/**
 * Player who controls `terrain` (higher total Control score of models within 3" of
 * `terrain.polygon`, excluding manifestations and faction terrain), or `null` if tied/uncontested.
 */
export function terrainController(
  scenario: Scenario,
  state: GameState,
  terrain: TerrainFeature,
): PlayerId | null {
  const scores: [number, number] = [0, 0];
  for (const id of state.unitOrder) {
    const unit = state.units[id]!;
    if (unit.status !== 'battlefield' || unit.isManifestation) continue;
    const profile = profileOf(scenario, unit);
    if (profile.control <= 0 || profile.isFactionTerrain || profile.isManifestation) continue;
    for (const i of aliveIndices(unit)) {
      const fp = modelFootprint(scenario, unit, i);
      if (footprintWithinTerrain(fp, terrain, TERRAIN_CONTROL_RANGE)) {
        scores[unit.owner] += profile.control;
      }
    }
  }
  if (scores[0] > scores[1]) return 0;
  if (scores[1] > scores[0]) return 1;
  return null;
}

// ─── 8. Place of Power ('placeOfPower' trait, spire-e, spire-w) ────────────────

/**
 * Returns the unused `'placeOfPower'` terrain feature within 3" of `unit` if `unit` can
 * activate a Place of Power now, or `null` otherwise.
 */
export function canUsePlaceOfPower(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): TerrainFeature | null {
  if (state.phase !== 'hero' || state.active !== unit.owner) return null;
  if (unit.status !== 'battlefield') return null;
  if (!hasEffectiveKeyword(scenario, state, unit, 'HERO')) return null;
  if (inCombat(scenario, state, unit)) return null;
  if ((unit.abilitiesUsed ?? []).includes(PLACE_OF_POWER_ID)) return null;

  const used = state.usedPlacesOfPower ?? [];
  for (const t of scenario.battlefield.terrain) {
    if (!t.traits.includes('placeOfPower')) continue;
    if (used.includes(t.id)) continue;
    if (unitWithinTerrain(scenario, unit, t, PLACE_OF_POWER_RANGE, false)) {
      return t;
    }
  }
  return null;
}

/**
 * Resolves `Activate Place of Power` for `unit`.
 * Marks the terrain feature and unit ability as used, adds the turn-long Place of Power
 * bonus effect (+1 cast/chant/unbind/banish), and rolls 1D6: on a 1, `unit` suffers D3
 * mortal damage; on a 2+ with `'ignite_fury'`, the player also gains 2 rage dice.
 */
export function resolvePlaceOfPower(ctx: Ctx, unit: UnitState, choice?: PlaceOfPowerBoon): void {
  const terrain = canUsePlaceOfPower(ctx.scenario, ctx.s, unit);
  if (!terrain) {
    illegal(`${unit.name} cannot use Place of Power now.`);
  }

  ctx.s.usedPlacesOfPower = [...(ctx.s.usedPlacesOfPower ?? []), terrain.id];
  unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), PLACE_OF_POWER_ID];

  const profile = profileOf(ctx.scenario, unit);
  const isCasterOrPriest = (profile.wizard ?? 0) > 0 || (profile.priest ?? 0) > 0;
  const boon: PlaceOfPowerBoon = choice ?? (isCasterOrPriest ? 'channelled_wrath' : 'ignite_fury');

  addEffect(ctx.s, {
    id: PLACE_OF_POWER_ID,
    name: 'Place of Power',
    sourceUnit: unit.id,
    targetUnit: unit.id,
    owner: unit.owner,
    expires: 'turn',
    data: {
      boon,
      castBonus: 1,
      chantBonus: 1,
      unbindBonus: 1,
      banishBonus: 1,
    },
  });

  const roll = ctx.rng.int(1, 6);
  ctx.events.push({
    t: 'roll',
    player: unit.owner,
    label: 'Place of Power',
    dice: [roll],
  });

  if (roll === 1) {
    const dmg = ctx.rng.int(1, 3);
    allocateDamage(ctx, unit, dmg, 'Place of Power');
  } else if (boon === 'ignite_fury') {
    const playerState = ctx.s.players[unit.owner];
    playerState.rageDice = (playerState.rageDice ?? 0) + 2;
  }
}
