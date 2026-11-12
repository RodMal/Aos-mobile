/** Placement legality for moves, runs, retreats, charges and pile-ins. */
import {
  checkCoherencyFootprints,
  footprintGap,
  footprintGapAtLeast,
  footprintInsidePolygon,
  footprintsOverlap,
  type Footprint,
  type Polygon,
} from '../geom/index.js';
import { hasEffectiveKeyword } from './abilities/effects.js';
import {
  aliveIndices,
  CHARGE_END_RANGE,
  COMBAT_RANGE,
  DIST_EPS,
  footprintWhollyWithin,
  gapToEnemies,
  unitBounds,
  modelFootprint,
  opponent,
  profileOf,
  unitFootprints,
  unitsOf,
} from './query.js';
import { pathBlockedModels, unstableTerrainViolations } from './terrain.js';
import type {
  GameState,
  Placement,
  PlaceReason,
  Scenario,
  UnitId,
  UnitState,
  Violation,
} from './types.js';

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
  caster?: UnitId;
  minEnemyGap?: number;
  /**
   * Power Through: enemy units the unit was in combat with when it started the move. It may
   * stay in combat with them (or leave), but not enter combat with any other unit.
   */
  engagedWith?: readonly UnitId[];
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

  if (rules.reason === 'summon') {
    const caster = rules.caster ? state.units[rules.caster] : undefined;
    const casterFps = caster ? unitFootprints(scenario, caster) : [];
    const notWhollyWithin = placement.models
      .filter((m) => !footprintWhollyWithin(ends.get(m.i)!, casterFps, rules.allowance))
      .map((m) => m.i);
    if (notWhollyWithin.length > 0) {
      violations.push({
        code: 'TOO_FAR',
        message: `Must be set up wholly within ${formatInches(rules.allowance)} of the caster.`,
        models: notWhollyWithin,
      });
    }
    const minGapReq = rules.minEnemyGap ?? 9;
    if (minGapReq > 0) {
      const tooCloseToEnemy = placement.models
        .filter(
          (m) => gapToEnemies(scenario, state, unit.owner, ends.get(m.i)!) <= minGapReq + DIST_EPS,
        )
        .map((m) => m.i);
      if (tooCloseToEnemy.length > 0) {
        violations.push({
          code: 'ENEMY_COMBAT_RANGE',
          message: `Must be set up more than ${formatInches(minGapReq)} from all enemy units.`,
          models: tooCloseToEnemy,
        });
      }
    }
  } else {
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
  }

  // Overlaps: with the unit's own models, and with every other model on the battlefield.
  const others: Footprint[] = [];
  const own = unitBounds(scenario, unit);
  for (const id of state.unitOrder) {
    const other = state.units[id]!;
    if (other.id === unit.id || other.status !== 'battlefield') continue;
    if (rules.reason !== 'summon') {
      const b = unitBounds(scenario, other);
      if (Math.hypot(b.x - own.x, b.y - own.y) - b.r - own.r > rules.allowance + 1) continue;
    }
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

  if (rules.reason === 'charge') {
    // At least one model must end within 1/2" of an enemy unit.
    const enemies = nearbyEnemyFootprints(scenario, state, unit, rules.allowance + 1);
    const reaches = placement.models.some((m) =>
      enemies.some((e) => !footprintGapAtLeast(ends.get(m.i)!, e, CHARGE_END_RANGE + DIST_EPS)),
    );
    if (!reaches) {
      violations.push({
        code: 'NOT_IN_CHARGE_RANGE',
        message: 'A charge must end with a model within ½" of an enemy unit.',
      });
    }
  }

  if (rules.reason === 'pileIn') {
    // No model may end further from the nearest enemy unit than it started.
    const enemies = nearbyEnemyFootprints(
      scenario,
      state,
      unit,
      PILE_IN_DISTANCE + COMBAT_RANGE * 4,
    );
    const further: number[] = [];
    for (const m of placement.models) {
      const before = minGap(modelFootprint(scenario, unit, m.i), enemies);
      const after = minGap(ends.get(m.i)!, enemies);
      if (after > before + DIST_EPS) further.push(m.i);
    }
    if (further.length > 0) {
      violations.push({
        code: 'PILE_IN_FURTHER',
        message: 'A pile-in cannot end further from the nearest enemy unit.',
        models: further,
      });
    }
  }

  if (
    rules.reason === 'normal' ||
    rules.reason === 'run' ||
    rules.reason === 'retreat' ||
    rules.reason === 'powerThrough'
  ) {
    const enemies = nearbyEnemyFootprints(
      scenario,
      state,
      unit,
      rules.allowance + COMBAT_RANGE,
      rules.reason === 'powerThrough' ? (rules.engagedWith ?? []) : [],
    );
    const fly = hasEffectiveKeyword(scenario, state, unit, 'FLY');
    const inRange = (fp: Footprint): boolean =>
      enemies.some((e) => !footprintGapAtLeast(fp, e, COMBAT_RANGE + DIST_EPS));
    const endsInRange: number[] = [];
    const passesRange: number[] = [];
    for (const m of placement.models) {
      if (inRange(ends.get(m.i)!)) {
        endsInRange.push(m.i);
        continue;
      }
      // A retreating or Power Through unit starts inside combat range, and a flying unit
      // ignores it on the way, so only the end position matters for them.
      if (rules.reason === 'retreat' || rules.reason === 'powerThrough' || fly) continue;
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
      const startedInCombat = rules.reason === 'retreat';
      violations.push({
        code: startedInCombat ? 'STILL_IN_COMBAT' : 'ENEMY_COMBAT_RANGE',
        message: startedInCombat
          ? 'This move must end more than 3" from all enemy units.'
          : rules.reason === 'powerThrough'
            ? 'Power Through cannot end in combat with a unit it was not already in combat with.'
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

  const unstable = unstableTerrainViolations(scenario, unit, placement);
  if (unstable.length > 0) {
    violations.push({
      code: 'BLOCKED',
      message: 'Models cannot end a move on unstable terrain.',
      models: unstable,
    });
  }

  if (rules.reason !== 'summon') {
    const blocked = pathBlockedModels(scenario, state, unit, placement);
    if (blocked.length > 0) {
      violations.push({
        code: 'BLOCKED',
        message: 'Non-flying models cannot move across other models.',
        models: blocked,
      });
    }
  }

  return violations;
}

/** Pile-in moves are up to 3". */
export const PILE_IN_DISTANCE = 3;

/**
 * Footprints of enemy models that could matter for a unit moving up to `reach` inches:
 * enemy units whose bounding circle is beyond reach plus the unit's own extent are skipped.
 */
function nearbyEnemyFootprints(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  reach: number,
  except: readonly UnitId[] = [],
): Footprint[] {
  const own = unitBounds(scenario, unit);
  const out: Footprint[] = [];
  for (const e of unitsOf(state, opponent(unit.owner))) {
    // Faction terrain creates no combat range and cannot be charged (owner's ruling).
    if (profileOf(scenario, e).isFactionTerrain) continue;
    if (except.includes(e.id)) continue;
    const b = unitBounds(scenario, e);
    if (Math.hypot(b.x - own.x, b.y - own.y) - b.r - own.r > reach + COMBAT_RANGE) continue;
    out.push(...unitFootprints(scenario, e));
  }
  return out;
}

function minGap(fp: Footprint, others: readonly Footprint[]): number {
  let best = Infinity;
  for (const o of others) {
    const d = footprintGap(fp, o);
    if (d < best) best = d;
  }
  return best;
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
