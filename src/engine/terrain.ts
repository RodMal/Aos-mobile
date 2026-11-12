/**
 * Terrain, Line of Sight (Obscuring), Cover, Unstable, Guarded Hero, Terrain Control,
 * and Place of Power (GHB 2026-27 Terrain 1.1-1.4 & Core Rules 25.0).
 */
import { canStandOn, type TerrainFeature } from '../data/battlefield.js';
import {
  distancePointToSegment,
  footprintDistanceToPolygon,
  footprintOuterRadius,
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
import { inflictMortalDamage } from './damage.js';
import {
  aliveIndices,
  COMBAT_RANGE,
  DIST_EPS,
  modelFootprint,
  profileOf,
  unitBounds,
  unitFootprints,
  unitsOf,
  unitsWithin,
} from './query.js';
import type { AttackMode, GameState, Placement, PlayerId, Scenario, UnitState } from './types.js';

/** Step size in inches when sampling straight-line movement paths. */
const PATH_STEP = 0.5;

/** Distance within which a unit is sheltered by Obscuring terrain. */
export const OBSCURING_RANGE = 1;
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

// ─── 2. Terrain models cannot stand on ──────────────────────────────────────────

/**
 * Sorted array of model indices `m.i` in `placement.models` whose placed footprint overlaps
 * a terrain feature models may not stand on (`canStandOn`: every kind not in
 * `LOW_TERRAIN_KINDS`, so the spires). Every part of every base is tested, whatever its shape.
 *
 * Unstable ("cannot end a move on it if it is more than 1" tall") adds nothing on top: a low
 * feature is 1" high or less, and a tall one is blocked here anyway.
 */
export function blockedTerrainViolations(
  scenario: Scenario,
  unit: UnitState,
  placement: Placement,
): number[] {
  const { battlefield } = scenario;
  const blocking = battlefield.terrain.filter((t) => !canStandOn(battlefield, t));
  if (blocking.length === 0) return [];
  const out: number[] = [];
  for (const m of placement.models) {
    const fp = modelFootprint(scenario, unit, m.i, m);
    if (blocking.some((t) => footprintOverlapsPolygon(fp, t.polygon))) out.push(m.i);
  }
  return out.sort((a, b) => a - b);
}

// ─── 3. Fly & Path-blocking ────────────────────────────────────────────────────

/**
 * Sorted array of model indices whose straight-line path from their current position to
 * `placement` passes across another unit's model on the battlefield.
 * Units with `FLY` ignore other models along their path. Terrain features permit crossing
 * and only block ending positions (checked via `blockedTerrainViolations`).
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

  const otherRadii = otherFootprints.map(footprintOuterRadius);
  const blocked: number[] = [];
  for (const m of placement.models) {
    const from = unit.models[m.i];
    if (!from) continue;
    const dist = Math.hypot(m.x - from.x, m.y - from.y);
    const steps = Math.ceil(dist / PATH_STEP);
    if (steps < 2) continue;
    // Every sampled position lies on the segment from -> m, and `footprintsOverlap` is false
    // whenever the centres are at least the sum of the outer radii apart: keep only the bases
    // that come closer than that to the segment (with a margin for rounding).
    const ra = footprintOuterRadius(modelFootprint(scenario, unit, m.i, m));
    const near: Footprint[] = [];
    for (let k = 0; k < otherFootprints.length; k++) {
      const o = otherFootprints[k]!;
      const d = distancePointToSegment([o.cx, o.cy], [from.x, from.y], [m.x, m.y]);
      if (d < ra + otherRadii[k]! + 1e-6) near.push(o);
    }
    if (near.length === 0) continue;
    for (let s = 1; s < steps; s++) {
      const f = (s * PATH_STEP) / dist;
      const at = {
        x: from.x + (m.x - from.x) * f,
        y: from.y + (m.y - from.y) * f,
        rot: m.rot,
      };
      const fp = modelFootprint(scenario, unit, m.i, at);
      if (near.some((otherFp) => footprintsOverlap(fp, otherFp))) {
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
 * - Otherwise a target with every model within 1" of an `'obscuring'` feature is not visible;
 *   sight lines through an Obscuring feature are not blocked (owner's ruling, 2026-11-11).
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

  // Obscuring (owner's ruling, 2026-11-11, from the printed wording): a unit with every model
  // within 1" of an Obscuring feature is visible only to enemy units within its combat range.
  // The feature does not block sight lines drawn through it otherwise.
  if (isUnitObscured(scenario, state, target)) return false;
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

  // Owner's ruling, 2026-11-11 (printed Cover: "behind or wholly on this terrain feature"):
  // being next to the feature, or wholly within 1" of it in the open, gives no cover.
  void mode;
  for (const t of scenario.battlefield.terrain) {
    if (!t.traits.includes('cover')) continue;
    if (unitWhollyOnTerrain(scenario, target, t)) return true;
    if (unitBehindTerrain(scenario, attacker, target, t)) return true;
  }
  return false;
}

// ─── 6. Guarded Hero (Core Rules 25.0) ─────────────────────────────────────────

/**
 * Checks whether `target` is a Guarded Hero (Core Rules 25.0):
 * - Has `HERO`, does not have `MONSTER` or `WAR MACHINE`.
 * - Within 3" (combat range) of a friendly unit that is not a `HERO`.
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
  // "If this Hero is within the combat range of a friendly unit that is not a Hero" (Core
  // Rules 25.0 as quoted in the earlier engine; awaiting the owner's confirmation). No Health
  // or model-count condition. Faction terrain has no combat range (owner's ruling).
  const hasBodyguard = unitsOf(state, target.owner).some((other) => {
    if (other.id === target.id) return false;
    if (profileOf(scenario, other).isFactionTerrain) return false;
    if (hasEffectiveKeyword(scenario, state, other, 'HERO')) return false;
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
 * Returns the Place of Power within 3" of `unit` if `unit` can activate one now, or `null`.
 * Owner's ruling, 2026-11-11: at the start of each turn, both players; once per turn per
 * army; only a friendly HERO within 3" of a Place of Power is needed (no control, combat
 * does not matter).
 */
export function canUsePlaceOfPower(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): TerrainFeature | null {
  if (unit.status !== 'battlefield') return null;
  if (!hasEffectiveKeyword(scenario, state, unit, 'HERO')) return null;
  if ((state.placeOfPowerUsedBy ?? []).includes(unit.owner)) return null;
  for (const t of scenario.battlefield.terrain) {
    if (!t.traits.includes('placeOfPower')) continue;
    if (unitWithinTerrain(scenario, unit, t, PLACE_OF_POWER_RANGE, false)) {
      return t;
    }
  }
  return null;
}

/** The first of `player`'s heroes that can activate a Place of Power now, with the feature. */
export function placeOfPowerCandidate(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): { hero: UnitState; terrain: TerrainFeature } | null {
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    if (u.owner !== player) continue;
    const terrain = canUsePlaceOfPower(scenario, state, u);
    if (terrain) return { hero: u, terrain };
  }
  return null;
}

/**
 * Resolves `Activate Place of Power` for `unit` with player's chosen `boon`
 * (Ignite Fury, Channelled Wrath, or Dizzying Rage).
 *
 * Rolls 1D6:
 * - On a 1: The Hero takes D3 mortal damage. Backfire!
 * - On a 2+: The chosen boon is granted:
 *   - Ignite Fury: Gain 2 rage dice and increase fury level by 2 (max 7).
 *   - Channelled Wrath: +1 to casting and chanting rolls for this hero this turn.
 *   - Dizzying Rage: Hero can Unbind or Banish once this turn.
 */
export function resolvePlaceOfPower(
  ctx: Ctx,
  unit: UnitState,
  choice: PlaceOfPowerBoon = 'channelled_wrath',
): void {
  const terrain = canUsePlaceOfPower(ctx.scenario, ctx.s, unit);
  if (!terrain) {
    illegal(`${unit.name} cannot use Place of Power now.`);
  }

  ctx.s.placeOfPowerUsedBy = [...(ctx.s.placeOfPowerUsedBy ?? []), unit.owner];
  unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), PLACE_OF_POWER_ID];

  const roll = ctx.rng.int(1, 6);
  ctx.events.push({
    t: 'roll',
    player: unit.owner,
    label: `Place of Power (${choice})`,
    dice: [roll],
  });

  if (roll === 1) {
    const dmg = ctx.rng.int(1, 3);
    ctx.events.push({
      t: 'roll',
      player: unit.owner,
      label: 'Place of Power backfire (D3 mortal damage)',
      dice: [dmg],
    });
    inflictMortalDamage(ctx, unit, dmg, 'Place of Power');
    return;
  }

  if (choice === 'ignite_fury') {
    const playerState = ctx.s.players[unit.owner];
    playerState.rageDice = (playerState.rageDice ?? 0) + 2;
    playerState.furyLevel = Math.min(7, (playerState.furyLevel ?? 0) + 2);
    ctx.events.push({
      t: 'note',
      text: `${unit.name} activates Place of Power (Ignite Fury): +2 rage dice, +2 fury level.`,
    });
  } else if (choice === 'channelled_wrath') {
    addEffect(ctx.s, {
      id: PLACE_OF_POWER_ID,
      name: 'Place of Power (Channelled Wrath)',
      sourceUnit: unit.id,
      targetUnit: unit.id,
      owner: unit.owner,
      expires: 'turn',
      data: {
        boon: 'channelled_wrath',
        castBonus: 1,
        chantBonus: 1,
      },
    });
    ctx.events.push({
      t: 'note',
      text: `${unit.name} activates Place of Power (Channelled Wrath): +1 to casting and chanting rolls this turn.`,
    });
  } else if (choice === 'dizzying_rage') {
    addEffect(ctx.s, {
      id: PLACE_OF_POWER_ID,
      name: 'Place of Power (Dizzying Rage)',
      sourceUnit: unit.id,
      targetUnit: unit.id,
      owner: unit.owner,
      expires: 'turn',
      data: {
        boon: 'dizzying_rage',
        unbindBonus: 1,
        banishBonus: 1,
        canUnbindOrBanish: true,
      },
    });
    ctx.events.push({
      t: 'note',
      text: `${unit.name} activates Place of Power (Dizzying Rage): can unbind or banish once this turn.`,
    });
  }
}
