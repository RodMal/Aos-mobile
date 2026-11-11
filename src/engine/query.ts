/** Read-only questions about a game state: footprints, distances, who is in combat. */
import type { UnitProfile } from '../data/profile.js';
import {
  baseFootprint,
  boundingRadius,
  footprintGap,
  footprintGapAtLeast,
  footprintOverlapsPolygon,
  footprintPolygon,
  layoutFormation,
  type Footprint,
} from '../geom/index.js';
import type { GameState, Placement, PlayerId, Scenario, UnitId, UnitState } from './types.js';

/** Units within this distance of an enemy unit are in combat with it. */
export const COMBAT_RANGE = 3;
/** A charge must end within this distance of an enemy unit. */
export const CHARGE_END_RANGE = 0.5;
/** Tolerance for distance comparisons, in inches. */
export const DIST_EPS = 1e-6;
/** Range of Sylvaneth Creeping Overgrowth around Awakened Wyldwoods and overgrown terrain. */
export const CREEPING_OVERGROWTH_RANGE = 6;

export function opponent(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export function unitById(state: GameState, id: UnitId): UnitState {
  const unit = state.units[id];
  if (!unit) throw new Error(`unknown unit ${id}`);
  return unit;
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

/** A circle around all of the unit's living bases: centre and radius in inches. */
export function unitBounds(
  scenario: Scenario,
  unit: UnitState,
): { x: number; y: number; r: number } {
  const c = unitCentre(unit);
  let r = 0;
  for (const i of aliveIndices(unit)) {
    const m = unit.models[i]!;
    const fp = modelFootprint(scenario, unit, i);
    r = Math.max(r, Math.hypot(m.x - c.x, m.y - c.y) + boundingRadius(fp));
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

/** Enemy units within `range` of `unit`. */
export function enemiesWithin(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  range: number,
): UnitState[] {
  return unitsOf(state, opponent(unit.owner)).filter((enemy) =>
    unitsWithin(scenario, unit, enemy, range),
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
    for (const efp of unitFootprints(scenario, enemy)) {
      const d = footprintGap(fp, efp);
      if (d < best) best = d;
    }
  }
  return best;
}

export function inCombat(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return enemiesInCombat(scenario, state, unit).length > 0;
}

export function hasKeyword(scenario: Scenario, unit: UnitState, keyword: string): boolean {
  return profileOf(scenario, unit).keywords.includes(keyword);
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
 * True when `unit` is within `CREEPING_OVERGROWTH_RANGE` (6") of any Awakened Wyldwood owned
 * by `sylvanethOwner` or any overgrown terrain feature, or (for friendly Sylvaneth units that
 * require wholly within) wholly within `CREEPING_OVERGROWTH_RANGE` when `wholly` is true.
 */
export function inCreepingOvergrowth(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  sylvanethOwner: PlayerId,
  wholly = false,
): boolean {
  const wyldwoods = unitsOf(state, sylvanethOwner).filter((u) => {
    const p = profileOf(scenario, u);
    return p.isFactionTerrain || p.keywords.includes('AWAKENED WYLDWOOD');
  });
  for (const w of wyldwoods) {
    if (wholly) {
      if (unitWhollyWithin(scenario, w, unit, CREEPING_OVERGROWTH_RANGE)) return true;
    } else if (unitsWithin(scenario, w, unit, CREEPING_OVERGROWTH_RANGE)) {
      return true;
    }
  }
  const overgrownIds = state.overgrownTerrain ?? [];
  if (overgrownIds.length > 0) {
    const tgtFps = unitFootprints(scenario, unit);
    for (const terrain of scenario.battlefield.terrain) {
      if (!overgrownIds.includes(terrain.id)) continue;
      // Check if unit overlaps or is within 6" of the terrain polygon
      for (const fp of tgtFps) {
        const expanded: Footprint =
          fp.kind === 'circle'
            ? { ...fp, r: fp.r + CREEPING_OVERGROWTH_RANGE }
            : {
                kind: 'circle',
                cx: fp.cx,
                cy: fp.cy,
                r: boundingRadius(fp) + CREEPING_OVERGROWTH_RANGE,
              };
        if (footprintOverlapsPolygon(expanded, terrain.polygon)) return true;
      }
    }
  }
  return false;
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
