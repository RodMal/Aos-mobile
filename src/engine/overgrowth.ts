/**
 * Sylvaneth overgrown tokens and the creeping overgrowth (the one implementation every rule
 * uses: battle traits, spells, prayers and warscroll abilities).
 *
 * The Creeping Overgrowth (bf2f-f70a-be1e-4d63): "The creeping overgrowth is measured from
 * each terrain feature that has a friendly overgrown token. The range ... is based on the
 * number of friendly overgrown tokens on the battlefield: 0-2: 6", 3-5: 9", 6-8: 12", 9+:
 * whole battlefield."
 *
 * Terrain features are the battlefield's terrain plus faction terrain set up on it (Awakened
 * Wyldwoods, the Seraphon Realmshaper Engine). Tokens are kept per player in
 * `GameState.overgrown`. An Awakened Wyldwood gets its owner's token when it is set up
 * (Budding Forest, 3885-ae8f-a0ed-7b62); the engine treats every friendly Wyldwood on the
 * battlefield as carrying one, so the token goes when the Wyldwood does.
 *
 * This module imports only geometry and `query.ts`, so the ability framework can use it.
 */
import {
  distancePointToBoundary,
  footprintDistanceToPolygon,
  footprintOverlapsPolygon,
  footprintPolygon,
  pointInPolygon,
  type Footprint,
  type Polygon,
} from '../geom/index.js';
import {
  aliveIndices,
  DIST_EPS,
  footprintsDistance,
  modelFootprint,
  profileOf,
  unitFootprints,
  unitsOf,
} from './query.js';
import type { GameState, PlayerId, Scenario, UnitState } from './types.js';

/** Terrain control range (Core Rules): models within 3" of a terrain feature contest it. */
const TERRAIN_CONTROL_RANGE = 3;

/** A terrain feature that can carry overgrown tokens. */
export interface OvergrowthFeature {
  id: string;
  name: string;
  /** Battlefield terrain: its footprint. */
  polygon?: Polygon;
  /** Faction terrain: the unit standing for it. */
  unit?: UnitState;
}

/** True for an Awakened Wyldwood (Sylvaneth faction terrain). */
export function isAwakenedWyldwood(scenario: Scenario, unit: UnitState): boolean {
  const p = profileOf(scenario, unit);
  return (
    p.isFactionTerrain &&
    (p.keywords.includes('AWAKENED WYLDWOOD') || p.name === 'Awakened Wyldwood')
  );
}

/** Every terrain feature on the battlefield: authored terrain, then faction terrain. */
export function terrainFeatures(scenario: Scenario, state: GameState): OvergrowthFeature[] {
  const out: OvergrowthFeature[] = scenario.battlefield.terrain.map((t) => ({
    id: t.id,
    name: t.name,
    polygon: t.polygon,
  }));
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    if (u.status === 'battlefield' && profileOf(scenario, u).isFactionTerrain) {
      out.push({ id: u.id, name: u.name, unit: u });
    }
  }
  return out;
}

/** IDs of the terrain features that have a friendly overgrown token for `player`. */
export function overgrownTokenIds(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): string[] {
  const features = terrainFeatures(scenario, state);
  const ids = new Set<string>();
  for (const f of features) {
    if (f.unit && f.unit.owner === player && isAwakenedWyldwood(scenario, f.unit)) ids.add(f.id);
  }
  const stored = state.overgrown?.[player] ?? [];
  for (const id of stored) if (features.some((f) => f.id === id)) ids.add(id);
  return [...ids];
}

/** True when the feature has a friendly overgrown token for `player`. */
export function hasOvergrownToken(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  featureId: string,
): boolean {
  return overgrownTokenIds(scenario, state, player).includes(featureId);
}

/** Gives `featureId` a friendly overgrown token for `player`. Mutates `state`. */
export function giveOvergrownToken(state: GameState, player: PlayerId, featureId: string): void {
  const both: [string[], string[]] = [
    [...(state.overgrown?.[0] ?? [])],
    [...(state.overgrown?.[1] ?? [])],
  ];
  if (!both[player].includes(featureId)) both[player].push(featureId);
  state.overgrown = both;
}

/** Creeping overgrowth range for a number of friendly tokens (Infinity: whole battlefield). */
export function creepingOvergrowthRange(tokens: number): number {
  if (tokens >= 9) return Infinity;
  if (tokens >= 6) return 12;
  if (tokens >= 3) return 9;
  return 6;
}

/** Edge distance from a set of bases to a feature (0 when touching or overlapping it). */
export function featureDistance(
  scenario: Scenario,
  feature: OvergrowthFeature,
  fps: readonly Footprint[],
): number {
  if (fps.length === 0) return Infinity;
  if (feature.unit) return footprintsDistance(fps, unitFootprints(scenario, feature.unit));
  const poly = feature.polygon!;
  let best = Infinity;
  for (const fp of fps) {
    if (footprintOverlapsPolygon(fp, poly)) return 0;
    best = Math.min(best, footprintDistanceToPolygon(fp, poly));
  }
  return best;
}

/** Distance from a point to the feature (0 inside it). */
function pointToFeature(
  scenario: Scenario,
  feature: OvergrowthFeature,
  p: readonly [number, number],
): number {
  if (feature.polygon) {
    return pointInPolygon(p, feature.polygon) ? 0 : distancePointToBoundary(p, feature.polygon);
  }
  let best = Infinity;
  for (const fp of unitFootprints(scenario, feature.unit!)) {
    const poly = footprintPolygon(fp);
    best = Math.min(best, pointInPolygon(p, poly) ? 0 : distancePointToBoundary(p, poly));
  }
  return best;
}

/** True when every part of every base in `fps` is within `range` of the feature. */
export function whollyWithinFeature(
  scenario: Scenario,
  feature: OvergrowthFeature,
  fps: readonly Footprint[],
  range: number,
): boolean {
  if (fps.length === 0) return false;
  return fps.every((fp) =>
    footprintPolygon(fp).every((p) => pointToFeature(scenario, feature, p) <= range + DIST_EPS),
  );
}

/**
 * True when `unit` is within (or, with `wholly`, wholly within) `player`'s creeping
 * overgrowth.
 */
export function inCreepingOvergrowth(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  player: PlayerId,
  wholly = false,
): boolean {
  if (unit.status !== 'battlefield') return false;
  const ids = overgrownTokenIds(scenario, state, player);
  if (ids.length === 0) return false;
  const range = creepingOvergrowthRange(ids.length);
  if (range === Infinity) return true;
  const fps = unitFootprints(scenario, unit);
  for (const f of terrainFeatures(scenario, state)) {
    if (!ids.includes(f.id) || f.unit?.id === unit.id) continue;
    if (wholly) {
      if (whollyWithinFeature(scenario, f, fps, range)) return true;
    } else if (featureDistance(scenario, f, fps) <= range + DIST_EPS) {
      return true;
    }
  }
  return false;
}

/**
 * Player who controls the feature: the higher total Control of models within 3" of it
 * (manifestations and faction terrain do not count), or null when tied.
 */
export function featureController(
  scenario: Scenario,
  state: GameState,
  feature: OvergrowthFeature,
): PlayerId | null {
  const scores: [number, number] = [0, 0];
  for (const id of state.unitOrder) {
    const unit = state.units[id]!;
    if (unit.status !== 'battlefield' || unit.isManifestation) continue;
    const p = profileOf(scenario, unit);
    if (p.control <= 0 || p.isFactionTerrain || p.isManifestation) continue;
    for (const i of aliveIndices(unit)) {
      const fp = modelFootprint(scenario, unit, i);
      if (featureDistance(scenario, feature, [fp]) <= TERRAIN_CONTROL_RANGE + DIST_EPS) {
        scores[unit.owner] += p.control;
      }
    }
  }
  if (scores[0] > scores[1]) return 0;
  if (scores[1] > scores[0]) return 1;
  return null;
}

/**
 * The terrain feature closest to `fps` that has no friendly overgrown token for `player`
 * (ties go to the first in battlefield order), or null when every feature has one.
 * `excludeId` leaves out the feature measured from.
 */
export function closestFeatureWithoutToken(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  fps: readonly Footprint[],
  excludeId?: string,
): OvergrowthFeature | null {
  const tokens = overgrownTokenIds(scenario, state, player);
  let best: OvergrowthFeature | null = null;
  let bestD = Infinity;
  for (const f of terrainFeatures(scenario, state)) {
    if (f.id === excludeId || tokens.includes(f.id)) continue;
    const d = featureDistance(scenario, f, fps);
    if (d < bestD - DIST_EPS) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/** Awakened Wyldwoods `player` has on the battlefield. */
export function friendlyWyldwoods(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  return unitsOf(state, player).filter((u) => isAwakenedWyldwood(scenario, u));
}
