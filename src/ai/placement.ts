/**
 * Placement builders for the NPC and the UI. Each takes a state whose pending decision is
 * a `place` decision for the unit, tries a few candidate placements (whole-unit shifts and
 * `formPlacement` formations, shorter ones after longer ones) and returns the first one
 * `engine.checkPlacement` accepts, or null.
 */
import {
  facingTowards,
  formPlacement,
  modelFootprint,
  opponent,
  shiftPlacement,
  currentPlacement,
  unitCentre,
  unitFootprints,
  unitsOf,
  aliveIndices,
  type Engine,
  type GameState,
  type Placement,
  type UnitId,
} from '../engine/index.js';
import { footprintGap } from '../geom/index.js';

interface PlaceInfo {
  unit: UnitId;
  allowance: number;
}

function placeInfo(engine: Engine, state: GameState, unitId: UnitId): PlaceInfo | null {
  const d = engine.decision(state);
  if (!d || d.kind !== 'place' || d.unit !== unitId) return null;
  return { unit: d.unit, allowance: d.allowance };
}

function legal(engine: Engine, state: GameState, p: Placement): boolean {
  return engine.checkPlacement(state, p).length === 0;
}

/**
 * Moves the unit up to `distance` inches towards `target` (never more than the allowance).
 * Tries the straight line, then up to 50 degrees either side, then shorter moves.
 */
export function moveTowards(
  engine: Engine,
  state: GameState,
  unitId: UnitId,
  target: { x: number; y: number },
  distance = Infinity,
): Placement | null {
  const info = placeInfo(engine, state, unitId);
  if (!info) return null;
  const unit = state.units[unitId]!;
  const c = unitCentre(unit);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  const len = Math.hypot(dx, dy);
  const want = Math.min(info.allowance, distance, len);
  if (want < 0.25 || len === 0) return null;
  const base = currentPlacement(unit);
  for (const frac of [1, 0.75, 0.5, 0.25]) {
    const step = want * frac;
    if (step < 0.25) break;
    for (const deg of [0, 25, -25, 50, -50]) {
      const a = (deg * Math.PI) / 180;
      const ux = (dx / len) * Math.cos(a) - (dy / len) * Math.sin(a);
      const uy = (dx / len) * Math.sin(a) + (dy / len) * Math.cos(a);
      const shifted = shiftPlacement(base, ux * step, uy * step);
      if (legal(engine, state, shifted)) return shifted;
      if (deg === 0) {
        const centre = { x: c.x + ux * step, y: c.y + uy * step };
        const formed = formPlacement(engine.scenario, unit, centre, facingTowards(centre, target));
        if (legal(engine, state, formed)) return formed;
      }
    }
  }
  return null;
}

/** Closest pairs (own model, enemy model) by edge-to-edge gap, nearest first. */
export function closestPairs(
  engine: Engine,
  state: GameState,
  unitId: UnitId,
): { from: { x: number; y: number }; to: { x: number; y: number }; gap: number }[] {
  const unit = state.units[unitId]!;
  const enemies = unitsOf(state, opponent(unit.owner)).flatMap((e) =>
    unitFootprints(engine.scenario, e),
  );
  const pairs: { from: { x: number; y: number }; to: { x: number; y: number }; gap: number }[] = [];
  for (const i of aliveIndices(unit)) {
    const fp = modelFootprint(engine.scenario, unit, i);
    for (const e of enemies) {
      pairs.push({
        from: { x: fp.cx, y: fp.cy },
        to: { x: e.cx, y: e.cy },
        gap: footprintGap(fp, e),
      });
    }
  }
  return pairs.sort((a, b) => a.gap - b.gap);
}

/**
 * A charge placement: the whole unit slides towards one of the nearest enemy models until
 * that pair is within 1/2", trying the nearest few enemy models in turn.
 */
export function chargePlacement(
  engine: Engine,
  state: GameState,
  unitId: UnitId,
): Placement | null {
  const info = placeInfo(engine, state, unitId);
  if (!info) return null;
  const unit = state.units[unitId]!;
  const base = currentPlacement(unit);
  const pairs = closestPairs(engine, state, unitId)
    .filter((p) => p.gap <= info.allowance + 0.5)
    .slice(0, 10);
  for (const p of pairs) {
    const dx = p.to.x - p.from.x;
    const dy = p.to.y - p.from.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    for (const end of [0.1, 0.25, 0.4]) {
      const baseStep = p.gap - end;
      if (baseStep < 0 || baseStep > info.allowance) continue;
      for (const extra of [0, 0.5]) {
        const step = baseStep + extra;
        if (step > info.allowance) continue;
        for (const deg of [0, 10, -10, 20, -20]) {
          const a = (deg * Math.PI) / 180;
          const ux = (dx / len) * Math.cos(a) - (dy / len) * Math.sin(a);
          const uy = (dx / len) * Math.sin(a) + (dy / len) * Math.cos(a);
          const shifted = shiftPlacement(base, ux * step, uy * step);
          if (legal(engine, state, shifted)) return shifted;
        }
      }
    }
  }
  return null;
}

/** A pile-in placement: the whole unit slides up to 3" towards the nearest enemy model. */
export function pileInPlacement(
  engine: Engine,
  state: GameState,
  unitId: UnitId,
): Placement | null {
  const info = placeInfo(engine, state, unitId);
  if (!info) return null;
  const unit = state.units[unitId]!;
  const base = currentPlacement(unit);
  const nearest = closestPairs(engine, state, unitId)[0];
  if (!nearest || nearest.gap < 0.1) return null;
  const dx = nearest.to.x - nearest.from.x;
  const dy = nearest.to.y - nearest.from.y;
  const len = Math.hypot(dx, dy);
  const full = Math.min(info.allowance, nearest.gap - 0.05);
  for (const frac of [1, 0.66, 0.33]) {
    const step = full * frac;
    const shifted = shiftPlacement(base, (dx / len) * step, (dy / len) * step);
    if (legal(engine, state, shifted)) return shifted;
  }
  return null;
}
