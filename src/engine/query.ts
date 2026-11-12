/** Read-only questions about a game state: footprints, distances, who is in combat. */
import type { UnitProfile } from '../data/profile.js';
import {
  BASE_POLYGON_SEGMENTS,
  baseFootprint,
  boundingRadius,
  footprintGap,
  footprintGapAtLeast,
  footprintOuterRadius,
  footprintPolygon,
  layoutFormation,
  type Footprint,
  trunkFootprint,
} from '../geom/index.js';
import type { GameState, Placement, PlayerId, Scenario, UnitId, UnitState } from './types.js';

/** Units within this distance of an enemy unit are in combat with it. */
export const COMBAT_RANGE = 3;
/** A charge must end within this distance of an enemy unit. */
export const CHARGE_END_RANGE = 0.5;
/** Tolerance for distance comparisons, in inches. */
export const DIST_EPS = 1e-6;

export function opponent(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export function unitById(state: GameState, id: UnitId): UnitState {
  const unit = state.units[id];
  if (!unit) throw new Error(`unknown unit ${id}`);
  return unit;
}

/** The attacker: the player whose side is the battlefield's attacker side. */
export function attackerOf(scenario: Scenario): PlayerId {
  return scenario.sides[0] === scenario.battlefield.attackerSide ? 0 : 1;
}

export function profileOf(scenario: Scenario, unit: UnitState): UnitProfile {
  const profile = scenario.profiles[unit.profileId];
  if (!profile) throw new Error(`unknown profile ${unit.profileId}`);
  return profile;
}

/** Units of `player` that are on the battlefield. */
export function unitsOf(state: GameState, player: PlayerId): UnitState[] {
  return state.unitOrder
    .map((id) => state.units[id]!)
    .filter((u) => u.owner === player && u.status === 'battlefield');
}

export function aliveIndices(unit: UnitState): number[] {
  const out: number[] = [];
  unit.models.forEach((m, i) => {
    if (m.alive) out.push(i);
  });
  return out;
}

export function aliveCount(unit: UnitState): number {
  let n = 0;
  for (const m of unit.models) if (m.alive) n++;
  return n;
}

/** Footprint of model `i` of `unit`, at its current position or at `at`. */
export function modelFootprint(
  scenario: Scenario,
  unit: UnitState,
  i: number,
  at?: { x: number; y: number; rot: number },
): Footprint {
  const base = profileOf(scenario, unit).models[i]!.base;
  const pos = at ?? unit.models[i]!;
  return baseFootprint(base, pos.x, pos.y, pos.rot);
}

/**
 * True for a unit models may stand on except at its trunk zones (the Awakened Wyldwood,
 * owner's ruling 2026-11-12).
 */
export function hasTrunk(scenario: Scenario, unit: UnitState): boolean {
  const base = profileOf(scenario, unit).models[0]?.base;
  return base?.kind === 'outline' && !!base.trunk;
}

/** Trunk zones of the unit's living models (empty for a unit without them). */
export function unitTrunks(scenario: Scenario, unit: UnitState): Footprint[] {
  const out: Footprint[] = [];
  for (const i of aliveIndices(unit)) {
    const m = unit.models[i]!;
    const fp = trunkFootprint(profileOf(scenario, unit).models[i]!.base, m.x, m.y, m.rot);
    if (fp) out.push(fp);
  }
  return out;
}

/**
 * What blocks other models standing or moving: a unit's bases, or only the trunk zones of a
 * piece models may stand on.
 */
export function blockingFootprints(scenario: Scenario, unit: UnitState): Footprint[] {
  return hasTrunk(scenario, unit) ? unitTrunks(scenario, unit) : unitFootprints(scenario, unit);
}

/** Footprints of the unit's living models, in model-index order. */
export function unitFootprints(scenario: Scenario, unit: UnitState): Footprint[] {
  return aliveIndices(unit).map((i) => modelFootprint(scenario, unit, i));
}

/** Mean position of the unit's living models. */
export function unitCentre(unit: UnitState): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const m of unit.models) {
    if (!m.alive) continue;
    x += m.x;
    y += m.y;
    n++;
  }
  return n === 0 ? { x: 0, y: 0 } : { x: x / n, y: y / n };
}

/** Smallest edge-to-edge distance between two sets of bases. */
export function footprintsDistance(a: readonly Footprint[], b: readonly Footprint[]): number {
  let best = Infinity;
  for (const fa of a) {
    for (const fb of b) {
      const d = footprintGap(fa, fb);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Edge-to-edge distance between the closest models of two units. */
export function unitDistance(scenario: Scenario, a: UnitState, b: UnitState): number {
  return footprintsDistance(unitFootprints(scenario, a), unitFootprints(scenario, b));
}

/** True when any base in `a` is within `range` inches of any base in `b`. */
export function footprintsWithin(
  a: readonly Footprint[],
  b: readonly Footprint[],
  range: number,
): boolean {
  for (const fa of a) {
    for (const fb of b) {
      if (!footprintGapAtLeast(fa, fb, range + DIST_EPS)) return true;
    }
  }
  return false;
}

const baseRadiiCache = new WeakMap<UnitProfile, number[]>();

/** Bounding radius of each model's base in a profile (static, so computed once). */
function baseRadii(profile: UnitProfile): number[] {
  let radii = baseRadiiCache.get(profile);
  if (!radii) {
    radii = profile.models.map((m) => boundingRadius(baseFootprint(m.base, 0, 0, 0)));
    baseRadiiCache.set(profile, radii);
  }
  return radii;
}

/** A circle around all of the unit's living bases: centre and radius in inches. */
export function unitBounds(
  scenario: Scenario,
  unit: UnitState,
): { x: number; y: number; r: number } {
  const c = unitCentre(unit);
  const radii = baseRadii(profileOf(scenario, unit));
  let r = 0;
  for (let i = 0; i < unit.models.length; i++) {
    const m = unit.models[i]!;
    if (!m.alive) continue;
    r = Math.max(r, Math.hypot(m.x - c.x, m.y - c.y) + radii[i]!);
  }
  return { ...c, r };
}

/** True when any base of `a` is within `range` of any base of `b` (bounding-circle first). */
export function unitsWithin(
  scenario: Scenario,
  a: UnitState,
  b: UnitState,
  range: number,
): boolean {
  const ba = unitBounds(scenario, a);
  const bb = unitBounds(scenario, b);
  if (Math.hypot(ba.x - bb.x, ba.y - bb.y) - ba.r - bb.r > range + DIST_EPS) return false;
  return footprintsWithin(unitFootprints(scenario, a), unitFootprints(scenario, b), range);
}

/**
 * True for faction terrain (Awakened Wyldwood, Realmshaper Engine). Owner's ruling,
 * 2026-11-11: it never acts, cannot be charged, never puts units in combat, and is a unit
 * only in the combat phase, where units within 3" of it may attack it.
 */
export function isFactionTerrainUnit(scenario: Scenario, unit: UnitState): boolean {
  return profileOf(scenario, unit).isFactionTerrain;
}

/**
 * `unitsWithin(unit, enemy)` for each enemy, building the unit's own circle and bases once.
 * Enemy faction terrain is skipped unless `includeTerrain`.
 */
function forEnemiesWithin(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  range: number,
  /** Return false to stop early. */
  visit: (enemy: UnitState) => boolean,
  includeTerrain = false,
): void {
  const bu = unitBounds(scenario, unit);
  let fps: Footprint[] | null = null;
  for (const enemy of unitsOf(state, opponent(unit.owner))) {
    if (!includeTerrain && isFactionTerrainUnit(scenario, enemy)) continue;
    const be = unitBounds(scenario, enemy);
    if (Math.hypot(bu.x - be.x, bu.y - be.y) - bu.r - be.r > range + DIST_EPS) continue;
    fps ??= unitFootprints(scenario, unit);
    if (!footprintsWithin(fps, unitFootprints(scenario, enemy), range)) continue;
    if (!visit(enemy)) return;
  }
}

/** Enemy units within `range` of `unit` (enemy faction terrain only with `includeTerrain`). */
export function enemiesWithin(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  range: number,
  includeTerrain = false,
): UnitState[] {
  const out: UnitState[] = [];
  forEnemiesWithin(
    scenario,
    state,
    unit,
    range,
    (enemy) => {
      out.push(enemy);
      return true;
    },
    includeTerrain,
  );
  return out;
}

/** True when `unit` is within 3" of enemy faction terrain, so it may attack it. */
export function nearEnemyFactionTerrain(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): boolean {
  return enemiesWithin(scenario, state, unit, COMBAT_RANGE, true).some((e) =>
    isFactionTerrainUnit(scenario, e),
  );
}

/** Enemy units in combat with `unit` (within 3"). */
export function enemiesInCombat(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitState[] {
  return enemiesWithin(scenario, state, unit, COMBAT_RANGE);
}

/** Indices of `attacker`'s living models within `range` of any living model of `target`. */
export function modelsWithinRangeOf(
  scenario: Scenario,
  attacker: UnitState,
  target: UnitState,
  range: number,
): number[] {
  const targets = unitFootprints(scenario, target);
  const out: number[] = [];
  for (const i of aliveIndices(attacker)) {
    const fp = modelFootprint(scenario, attacker, i);
    if (footprintsWithin([fp], targets, range)) out.push(i);
  }
  return out;
}

/** Smallest edge-to-edge gap from a footprint to any living enemy model of `owner`. */
export function gapToEnemies(
  scenario: Scenario,
  state: GameState,
  owner: PlayerId,
  fp: Footprint,
): number {
  let best = Infinity;
  for (const enemy of unitsOf(state, opponent(owner))) {
    if (isFactionTerrainUnit(scenario, enemy)) continue;
    for (const efp of unitFootprints(scenario, enemy)) {
      const d = footprintGap(fp, efp);
      if (d < best) best = d;
    }
  }
  return best;
}

export function inCombat(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  let found = false;
  forEnemiesWithin(scenario, state, unit, COMBAT_RANGE, () => {
    found = true;
    return false; // one is enough
  });
  return found;
}

export function hasKeyword(scenario: Scenario, unit: UnitState, keyword: string): boolean {
  return profileOf(scenario, unit).keywords.includes(keyword);
}

/** How far the vertices of a base's outer polygon (`footprintPolygon`) reach from its centre. */
const POLYGON_REACH = 1 / Math.cos(Math.PI / BASE_POLYGON_SEGMENTS);
function polygonRadius(fp: Footprint): number {
  if (fp.kind === 'polygon') return footprintOuterRadius(fp);
  if (fp.kind === 'rect') return Math.hypot(fp.hw, fp.hh);
  return (fp.kind === 'circle' ? fp.r : Math.max(fp.rx, fp.ry)) * POLYGON_REACH;
}

/** Radius of the largest circle centred on the base that fits inside it. */
function inscribedRadius(fp: Footprint): number {
  if (fp.kind === 'polygon') return 0;
  return fp.kind === 'circle'
    ? fp.r
    : fp.kind === 'ellipse'
      ? Math.min(fp.rx, fp.ry)
      : Math.min(fp.hw, fp.hh);
}

/**
 * True when every point of `target` is within `range` inches of at least one footprint in
 * `sources`.
 */
export function footprintWhollyWithin(
  target: Footprint,
  sources: readonly Footprint[],
  range: number,
): boolean {
  if (sources.length === 0) return false;
  if (target.kind === 'circle') {
    for (const src of sources) {
      if (
        src.kind === 'circle' &&
        Math.hypot(target.cx - src.cx, target.cy - src.cy) + target.r - src.r <= range + DIST_EPS
      ) {
        return true;
      }
    }
  }
  // Cheap answers from circles before the exact test below, which is costly. The exact test
  // samples the target's outer polygon against each source's outer polygon, so the circles
  // here are sized to those polygons and the answers are identical:
  // - yes, if every vertex of the target is within `range` of the largest circle inside one
  //   source (which lies inside that source's polygon);
  // - no, if no source's polygon can come within `range` of any vertex of the target.
  const tr = polygonRadius(target);
  let reachable = false;
  for (const src of sources) {
    const d = Math.hypot(target.cx - src.cx, target.cy - src.cy);
    if (d + tr - inscribedRadius(src) <= range) return true;
    if (d - tr - footprintOuterRadius(src) <= range + DIST_EPS) reachable = true;
  }
  if (!reachable) return false;
  const pts = footprintPolygon(target);
  return pts.every(([x, y]) => {
    const ptFp: Footprint = { kind: 'circle', cx: x, cy: y, r: 0 };
    return sources.some((src) => footprintGap(ptFp, src) <= range + DIST_EPS);
  });
}

/**
 * True when every living model of `target` is wholly within `range` inches of `source`.
 */
export function unitWhollyWithin(
  scenario: Scenario,
  source: UnitState,
  target: UnitState,
  range: number,
): boolean {
  const srcFps = unitFootprints(scenario, source);
  const tgtFps = unitFootprints(scenario, target);
  if (srcFps.length === 0 || tgtFps.length === 0) return false;
  return tgtFps.every((fp) => footprintWhollyWithin(fp, srcFps, range));
}

/**
 * Facing in degrees for a formation whose front rank should look from `from` towards `to`.
 * At 0 the front rank faces up the screen (-y); angles grow clockwise.
 */
export function facingTowards(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const deg = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * A placement that sets the unit's living models up in formation around `centre`.
 * `frontage` is the number of models in the front rank. This is the helper behind the UI's
 * unit drag and the NPC's moves; the result still has to pass `Engine.checkPlacement`.
 */
export function formPlacement(
  scenario: Scenario,
  unit: UnitState,
  centre: { x: number; y: number },
  facingDeg: number,
  frontage?: number,
): Placement {
  const profile = profileOf(scenario, unit);
  const alive = aliveIndices(unit);
  const bases = alive.map((i) => profile.models[i]!.base);
  const front = Math.max(1, Math.min(alive.length, frontage ?? defaultFrontage(alive.length)));
  const tokens = layoutFormation(bases, front, [centre.x, centre.y], facingDeg);
  return {
    unit: unit.id,
    models: tokens.map((t) => ({ i: alive[t.modelIndex]!, x: t.x, y: t.y, rot: t.rotation })),
  };
}

/** A sensible front-rank width for a unit of `n` models. */
export function defaultFrontage(n: number): number {
  if (n <= 3) return n;
  if (n <= 6) return 3;
  return Math.ceil(n / 2);
}

/** The unit's current positions as a placement (the "stay where you are" answer). */
export function currentPlacement(unit: UnitState): Placement {
  return {
    unit: unit.id,
    models: aliveIndices(unit).map((i) => {
      const m = unit.models[i]!;
      return { i, x: m.x, y: m.y, rot: m.rot };
    }),
  };
}

/** The same placement shifted by (dx, dy). */
export function shiftPlacement(placement: Placement, dx: number, dy: number): Placement {
  return {
    unit: placement.unit,
    models: placement.models.map((m) => ({ ...m, x: m.x + dx, y: m.y + dy })),
  };
}
