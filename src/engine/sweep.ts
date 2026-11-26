/**
 * Manifestation movement abilities: Scything Blade and The Pendulum Swings (Aethervoid
 * Pendulum), End Given Form (Purple Sun of Shyish) and Pulled to the Grave (Suffocating
 * Gravetide). Pure helpers: which ability a unit has, the units its move passed across, and
 * the straight-line rule. The mortal damage itself is rolled in `placing.ts`.
 */
import { footprintGap, footprintsOverlap, type Footprint } from '../geom/index.js';
import {
  aliveIndices,
  DIST_EPS,
  modelFootprint,
  opponent,
  profileOf,
  unitFootprints,
} from './query.js';
import type { GameState, Placement, Scenario, UnitState, Violation } from './types.js';

export const SCYTHING_BLADE_ID = '54d0-e6a1-c6e8-46a7';
export const PENDULUM_SWINGS_ID = '9ec5-1011-c05e-5045';
export const END_GIVEN_FORM_ID = '42b5-c322-7e12-371c';
export const PULLED_TO_THE_GRAVE_ID = '1fa3-5209-8869-8d58';

export type SweepKind = 'scything' | 'endGivenForm' | 'pulled';

/** Scything Blade targets are also enemy units within this range of the end position. */
export const SCYTHING_REACH = 0.5;
/** How finely the swept path is sampled, in inches. */
const SWEEP_STEP = 0.25;
/** A straight-line move may stray this far (inches) from the blade's axis, for rounding. */
const AXIS_TOLERANCE = 0.05;

export function sweepKind(scenario: Scenario, unit: UnitState): SweepKind | null {
  if (!unit.isManifestation) return null;
  const ids = profileOf(scenario, unit).abilities.map((a) => a.id);
  if (ids.includes(SCYTHING_BLADE_ID)) return 'scything';
  if (ids.includes(END_GIVEN_FORM_ID)) return 'endGivenForm';
  if (ids.includes(PULLED_TO_THE_GRAVE_ID)) return 'pulled';
  return null;
}

/** The Pendulum Swings: the unit may only move along (or against) its blade. */
export function mustMoveAlongBlade(scenario: Scenario, unit: UnitState): boolean {
  return (
    !!unit.isManifestation &&
    profileOf(scenario, unit).abilities.some((a) => a.id === PENDULUM_SWINGS_ID)
  );
}

/** Scything Blade may end the move in combat; the other three may not. */
export function mayEndMoveInCombat(scenario: Scenario, unit: UnitState): boolean {
  return sweepKind(scenario, unit) === 'scything';
}

/**
 * Violations of The Pendulum Swings for a placement: every model moves in a straight line
 * along its blade (its base's long axis, at the rotation it started with, either way) and
 * keeps that rotation.
 */
export function bladeViolations(unit: UnitState, placement: Placement): Violation[] {
  const bad: number[] = [];
  for (const m of placement.models) {
    const from = unit.models[m.i];
    if (!from) continue;
    const dx = m.x - from.x;
    const dy = m.y - from.y;
    const t = (from.rot * Math.PI) / 180;
    const lateral = Math.abs(dx * Math.sin(t) - dy * Math.cos(t));
    const turned = Math.abs(((((m.rot - from.rot) % 180) + 270) % 180) - 90);
    if (lateral > AXIS_TOLERANCE || turned > 0.5) bad.push(m.i);
  }
  return bad.length === 0
    ? []
    : [
        {
          code: 'BLOCKED',
          message: 'The Pendulum Swings: it must move in a straight line along its blade.',
          models: bad,
        },
      ];
}

/**
 * Enemy units whose models the move crosses (a base of `unit`, sampled along its straight
 * path, overlaps one of theirs, at the start, along the way or at the end), plus, when
 * `reach` > 0, enemy units within `reach` of an end position. Positions are those in
 * `unit` before the move and in `placement` after it. Faction terrain is not a target.
 */
export function passedAcross(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  placement: Placement,
  reach = 0,
): UnitState[] {
  const out: UnitState[] = [];
  const enemies = Object.values(state.units).filter(
    (e) =>
      e.owner === opponent(unit.owner) &&
      e.status === 'battlefield' &&
      !profileOf(scenario, e).isFactionTerrain,
  );
  for (const e of enemies) {
    if (aliveIndices(e).length === 0) continue;
    const fps: Footprint[] = unitFootprints(scenario, e);
    let hit = false;
    for (const m of placement.models) {
      const from = unit.models[m.i];
      if (!from || hit) continue;
      const dist = Math.hypot(m.x - from.x, m.y - from.y);
      const steps = Math.max(1, Math.ceil(dist / SWEEP_STEP));
      for (let s = 0; s <= steps && !hit; s++) {
        const f = s / steps;
        const at = { x: from.x + (m.x - from.x) * f, y: from.y + (m.y - from.y) * f, rot: m.rot };
        const fp = modelFootprint(scenario, unit, m.i, at);
        hit = fps.some((o) => footprintsOverlap(fp, o));
      }
      if (!hit && reach > 0) {
        const end = modelFootprint(scenario, unit, m.i, m);
        hit = fps.some((o) => footprintGap(end, o) <= reach + DIST_EPS);
      }
    }
    if (hit) out.push(e);
  }
  return out;
}
