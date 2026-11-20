/**
 * Building placements while the player drags: whole-unit drags, rotation, re-forming the
 * front rank and moving single models. Pure; the result still goes through
 * `engine.checkPlacement`.
 */
import {
  defaultFrontage,
  facingTowards,
  formPlacement,
  isFactionTerrainUnit,
  shiftPlacement,
  unitCentre,
  unitsOf,
  opponent,
  modelFootprint,
  unitFootprints,
  type GameState,
  type Placement,
  type Scenario,
  type UnitState,
} from '../../engine/index.js';
import { boundingRadius, footprintClosestPoints, footprintGap } from '../../geom/index.js';

export interface PlacementDraft {
  unit: string;
  /** The placement being edited. */
  placement: Placement;
  /** Facing of the formation in degrees (0 = front rank faces up the screen of the table). */
  facing: number;
  /** Models in the front rank, used when the formation is rebuilt. */
  frontage: number;
}

export function placementCentre(p: Placement): { x: number; y: number } {
  if (p.models.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const m of p.models) {
    x += m.x;
    y += m.y;
  }
  return { x: x / p.models.length, y: y / p.models.length };
}

/** The nearest enemy unit's centre, or null when the enemy has no units on the table. */
export function nearestEnemyCentre(
  state: GameState,
  unit: UnitState,
  from: { x: number; y: number },
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const e of unitsOf(state, opponent(unit.owner))) {
    const c = unitCentre(e);
    const d = Math.hypot(c.x - from.x, c.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** A draft that starts with the unit where it stands, facing the nearest enemy. */
export function startDraft(state: GameState, unit: UnitState): PlacementDraft {
  const placement: Placement = {
    unit: unit.id,
    models: unit.models.flatMap((m, i) => (m.alive ? [{ i, x: m.x, y: m.y, rot: m.rot }] : [])),
  };
  const centre = unitCentre(unit);
  const enemy = nearestEnemyCentre(state, unit, centre);
  return {
    unit: unit.id,
    placement,
    facing: enemy ? facingTowards(centre, enemy) : 0,
    frontage: defaultFrontage(placement.models.length),
  };
}

export function translateDraft(d: PlacementDraft, dx: number, dy: number): PlacementDraft {
  return { ...d, placement: shiftPlacement(d.placement, dx, dy) };
}

/** Moves the whole draft so its centre is at `to`. */
export function moveDraftTo(d: PlacementDraft, to: { x: number; y: number }): PlacementDraft {
  const c = placementCentre(d.placement);
  return translateDraft(d, to.x - c.x, to.y - c.y);
}

/** Rigid rotation about the draft's centre: keeps single-model adjustments. */
export function rotateDraft(d: PlacementDraft, deg: number): PlacementDraft {
  const c = placementCentre(d.placement);
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return {
    ...d,
    facing: (((d.facing + deg) % 360) + 360) % 360,
    placement: {
      unit: d.placement.unit,
      models: d.placement.models.map((m) => {
        const dx = m.x - c.x;
        const dy = m.y - c.y;
        return {
          i: m.i,
          x: c.x + dx * cos - dy * sin,
          y: c.y + dx * sin + dy * cos,
          rot: (((m.rot + deg) % 360) + 360) % 360,
        };
      }),
    },
  };
}

/** Rebuilds the formation around the draft's centre with a new facing and frontage. */
export function reformDraft(
  scenario: Scenario,
  unit: UnitState,
  d: PlacementDraft,
  facing: number,
  frontage: number,
): PlacementDraft {
  const n = d.placement.models.length;
  const front = Math.max(1, Math.min(n, frontage));
  const placement = formPlacement(scenario, unit, placementCentre(d.placement), facing, front);
  return { ...d, placement, facing, frontage: front };
}

/** Faces the formation towards the nearest enemy unit (rebuilding it). */
export function faceEnemy(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  d: PlacementDraft,
): PlacementDraft {
  const c = placementCentre(d.placement);
  const enemy = nearestEnemyCentre(state, unit, c);
  if (!enemy) return d;
  return reformDraft(scenario, unit, d, facingTowards(c, enemy), d.frontage);
}

export function moveModel(d: PlacementDraft, i: number, dx: number, dy: number): PlacementDraft {
  return {
    ...d,
    placement: {
      unit: d.placement.unit,
      models: d.placement.models.map((m) => (m.i === i ? { ...m, x: m.x + dx, y: m.y + dy } : m)),
    },
  };
}

/** How far each model moves from where it stands, by model index. */
export function modelDistances(unit: UnitState, p: Placement): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of p.models) {
    const from = unit.models[m.i]!;
    out.set(m.i, Math.hypot(m.x - from.x, m.y - from.y));
  }
  return out;
}

/** The furthest any model moves. */
export function maxDistance(unit: UnitState, p: Placement): number {
  let best = 0;
  for (const d of modelDistances(unit, p).values()) best = Math.max(best, d);
  return best;
}

/** A set-up measured from a caster (a summoned manifestation): who, how far, and the limit. */
export interface SetUpReach {
  caster: UnitState;
  range: number;
  /** How far the furthest part of any placed model is from the caster's nearest base. */
  dist: number;
}

/**
 * For a set-up wholly within range of a caster (`summon` place frames), the caster, the range
 * and the distance of the placement from it; null for every other placement. The engine's
 * `checkPlacement` stays the judge; this is for the ring, the measuring line and the status.
 */
export function setUpReach(
  scenario: Scenario,
  state: GameState,
  placement: Placement,
): SetUpReach | null {
  const top = state.stack[state.stack.length - 1];
  if (top?.t !== 'place' || top.reason !== 'summon' || !top.caster) return null;
  const caster = state.units[top.caster];
  const unit = state.units[placement.unit];
  if (!caster || !unit) return null;
  const sources = unitFootprints(scenario, caster);
  let dist = 0;
  for (const m of placement.models) {
    const fp = modelFootprint(scenario, unit, m.i, m);
    let near = Infinity;
    for (const src of sources) near = Math.min(near, footprintGap(fp, src));
    // The far side of the base: its gap plus its width along the line to the caster.
    dist = Math.max(dist, Math.max(0, near) + 2 * boundingRadius(fp));
  }
  return { caster, range: top.allowance, dist };
}

/** The printed limits of a set-up, the gap it needs from enemies and where the placement stands. */
export interface SetUpLimits {
  /** One line per printed limit, for the place panel. */
  limits: string[];
  /** "More than X inches from all enemy units"; 0 when the ability has no such limit. */
  gap: number;
  /** The nearest enemy unit to any model of the placement, with the edge-to-edge gap. */
  nearest: {
    name: string;
    dist: number;
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null;
}

const fmt = (n: number): string => (Number.isInteger(n) ? `${n}"` : `${n.toFixed(1)}"`);

/**
 * The limits of a `relocate` or `replacement` set-up (Shadowcreep, Realmroot Guide, Huntmaster's
 * Strike, Merciless Ambush, Rhythm of the Chase, Chameleon Ambush, the replacement units), and
 * the distance from the placement to the nearest enemy base. `checkPlacement` stays the judge.
 */
export function setUpLimits(
  scenario: Scenario,
  state: GameState,
  placement: Placement,
): SetUpLimits | null {
  const top = state.stack[state.stack.length - 1];
  if (top?.t !== 'place' || (top.reason !== 'relocate' && top.reason !== 'replacement')) {
    return null;
  }
  const unit = state.units[placement.unit];
  if (!unit) return null;
  const rel = top.relocate;
  const limits: string[] = [];
  let gap = top.minEnemyGap ?? 9;
  switch (rel?.kind) {
    case 'shadowcreep':
      limits.push('Wholly within 3" of a terrain feature');
      break;
    case 'ambush':
      limits.push('Within ½" of an enemy unit');
      limits.push(
        `Wholly within ${fmt(rel.reach ?? 0)} of a terrain feature with your overgrown token`,
      );
      gap = 0;
      break;
    case 'rhythm':
      limits.push(`Within 1" of ${(rel.target && state.units[rel.target]?.name) || 'the target'}`);
      gap = 0;
      break;
    case 'chameleon':
      limits.push('Anywhere on the battlefield');
      break;
    default:
      limits.push('Wholly within your creeping overgrowth');
  }
  if (gap > 0) limits.push(`More than ${fmt(gap)} from all enemy units`);
  let nearest: SetUpLimits['nearest'] = null;
  for (const enemy of unitsOf(state, opponent(unit.owner))) {
    if (isFactionTerrainUnit(scenario, enemy)) continue;
    const efps = unitFootprints(scenario, enemy);
    for (const m of placement.models) {
      const fp = modelFootprint(scenario, unit, m.i, m);
      for (const efp of efps) {
        const c = footprintClosestPoints(fp, efp);
        if (!nearest || c.gap < nearest.dist) {
          nearest = {
            name: enemy.name,
            dist: c.gap,
            from: { x: c.a[0], y: c.a[1] },
            to: { x: c.b[0], y: c.b[1] },
          };
        }
      }
    }
  }
  return { limits, gap, nearest };
}
