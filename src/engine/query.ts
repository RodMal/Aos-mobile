/** Read-only questions about a game state: footprints, distances, who is in combat. */
import type { UnitProfile } from '../data/profile.js';
import {
  baseFootprint,
  footprintGap,
  footprintGapAtLeast,
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

/** Enemy units in combat with `unit` (within 3"). */
export function enemiesInCombat(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitState[] {
  const own = unitFootprints(scenario, unit);
  return unitsOf(state, opponent(unit.owner)).filter((enemy) =>
    footprintsWithin(own, unitFootprints(scenario, enemy), COMBAT_RANGE),
  );
}

export function inCombat(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return enemiesInCombat(scenario, state, unit).length > 0;
}

export function hasKeyword(scenario: Scenario, unit: UnitState, keyword: string): boolean {
  return profileOf(scenario, unit).keywords.includes(keyword);
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
