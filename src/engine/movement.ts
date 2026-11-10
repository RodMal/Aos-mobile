/** Placement legality for moves (normal, run, retreat). Charges and pile-ins extend this. */
import {
  checkCoherencyFootprints,
  footprintGapAtLeast,
  footprintInsidePolygon,
  footprintsOverlap,
  type Footprint,
  type Polygon,
} from '../geom/index.js';
import {
  aliveIndices,
  COMBAT_RANGE,
  DIST_EPS,
  hasKeyword,
  modelFootprint,
  opponent,
  unitFootprints,
  unitsOf,
} from './query.js';
import type { GameState, Placement, PlaceReason, Scenario, UnitState, Violation } from './types.js';

/** How finely a model's straight-line path is sampled, in inches. */
const PATH_STEP = 0.5;

export function boardPolygon(scenario: Scenario): Polygon {
  const { width, height } = scenario.battlefield;
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
}

export interface PlaceRules {
  reason: PlaceReason;
  allowance: number;
}

/**
 * Checks a placement of `unit` against the rules for `reason`:
 * every living model placed once, on the battlefield, within its allowance, not on top of
 * another model, the unit in coherency, and (for normal moves, runs and retreats) never
 * within the combat range of an enemy unit, along the way or at the end.
 */
export function checkMovePlacement(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  placement: Placement,
  rules: PlaceRules,
): Violation[] {
  const violations: Violation[] = [];
  const alive = aliveIndices(unit);
  const placedIds = placement.models.map((m) => m.i).sort((a, b) => a - b);
  if (
    placement.unit !== unit.id ||
    placedIds.length !== alive.length ||
    placedIds.some((i, k) => i !== alive[k])
  ) {
    return [{ code: 'WRONG_MODELS', message: 'Every living model must be placed exactly once.' }];
  }

  const board = boardPolygon(scenario);
  const ends = new Map<number, Footprint>();
  for (const m of placement.models) ends.set(m.i, modelFootprint(scenario, unit, m.i, m));

  const offBoard = placement.models
    .filter((m) => !footprintInsidePolygon(ends.get(m.i)!, board))
    .map((m) => m.i);
  if (offBoard.length > 0) {
    violations.push({
      code: 'OFF_BOARD',
      message: 'Models must stay on the battlefield.',
      models: offBoard,
    });
  }

  const tooFar = placement.models
    .filter((m) => {
      const from = unit.models[m.i]!;
      return Math.hypot(m.x - from.x, m.y - from.y) > rules.allowance + DIST_EPS;
    })
    .map((m) => m.i);
  if (tooFar.length > 0) {
    violations.push({
      code: 'TOO_FAR',
      message: `Models can move up to ${formatInches(rules.allowance)}.`,
      models: tooFar,
    });
  }

  // Overlaps: with the unit's own models, and with every other model on the battlefield.
  const others: Footprint[] = [];
  for (const id of state.unitOrder) {
    const other = state.units[id]!;
    if (other.id === unit.id || other.status !== 'battlefield') continue;
    others.push(...unitFootprints(scenario, other));
  }
  const overlapping = new Set<number>();
  const list = placement.models.map((m) => ({ i: m.i, fp: ends.get(m.i)! }));
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      if (footprintsOverlap(list[a]!.fp, list[b]!.fp)) {
        overlapping.add(list[a]!.i);
        overlapping.add(list[b]!.i);
      }
    }
    if (others.some((o) => footprintsOverlap(list[a]!.fp, o))) overlapping.add(list[a]!.i);
  }
  if (overlapping.size > 0) {
    violations.push({
      code: 'OVERLAP',
      message: 'Bases cannot overlap.',
      models: [...overlapping].sort((a, b) => a - b),
    });
  }

  const coherency = checkCoherencyFootprints(alive.map((i) => ends.get(i)!));
  if (!coherency.coherent) {
    violations.push({
      code: 'COHERENCY',
      message:
        coherency.required === 2
          ? 'Each model must be within ½" of two others in its unit.'
          : 'Each model must be within ½" of another model in its unit.',
      models: coherency.lacking.map((k) => alive[k]!),
    });
  }

  if (rules.reason === 'normal' || rules.reason === 'run' || rules.reason === 'retreat') {
    const enemies = unitsOf(state, opponent(unit.owner)).flatMap((e) =>
      unitFootprints(scenario, e),
    );
    const fly = hasKeyword(scenario, unit, 'FLY');
    const inRange = (fp: Footprint): boolean =>
      enemies.some((e) => !footprintGapAtLeast(fp, e, COMBAT_RANGE + DIST_EPS));
    const endsInRange: number[] = [];
    const passesRange: number[] = [];
    for (const m of placement.models) {
      if (inRange(ends.get(m.i)!)) {
        endsInRange.push(m.i);
        continue;
      }
      // A retreating unit starts inside combat range, and a flying unit ignores it on the
      // way, so only the end position matters for them.
      if (rules.reason === 'retreat' || fly) continue;
      const from = unit.models[m.i]!;
      const dist = Math.hypot(m.x - from.x, m.y - from.y);
      const steps = Math.floor(dist / PATH_STEP);
      for (let s = 1; s <= steps; s++) {
        const f = (s * PATH_STEP) / dist;
        const at = { x: from.x + (m.x - from.x) * f, y: from.y + (m.y - from.y) * f, rot: m.rot };
        if (inRange(modelFootprint(scenario, unit, m.i, at))) {
          passesRange.push(m.i);
          break;
        }
      }
    }
    if (endsInRange.length > 0) {
      violations.push({
        code: rules.reason === 'retreat' ? 'STILL_IN_COMBAT' : 'ENEMY_COMBAT_RANGE',
        message:
          rules.reason === 'retreat'
            ? 'A retreat must end more than 3" from all enemy units.'
            : 'This move cannot end within 3" of an enemy unit.',
        models: endsInRange,
      });
    }
    if (passesRange.length > 0) {
      violations.push({
        code: 'ENEMY_COMBAT_RANGE',
        message: 'This move cannot pass within 3" of an enemy unit.',
        models: passesRange,
      });
    }
  }
  return violations;
}

/** The furthest any model moves in a placement. */
export function placementDistance(unit: UnitState, placement: Placement): number {
  let best = 0;
  for (const m of placement.models) {
    const from = unit.models[m.i]!;
    best = Math.max(best, Math.hypot(m.x - from.x, m.y - from.y));
  }
  return best;
}

export function formatInches(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}"`;
}
