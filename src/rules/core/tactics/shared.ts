/**
 * GHB 2026-27 "Scourge of Aqshy" Battle Tactics (Advanced Rules, Battle Tactics 2026-27).
 *
 * Each army brings 2 of the season's 6 Battle Tactic cards. Each card has 3 sequential
 * tiers: Affray -> Strike -> Domination, worth 5 VP each. At the end of a player's turn
 * (unless that player seized the initiative this battle round), each of their 2 cards
 * whose current tier condition is met advances one step and scores 5 VP.
 *
 * Ported from aos-webapp `rules/battleTactics.ts` and adapted to polygon territories and
 * exact model footprints.
 */
import type { ObjectiveSpec, TerrainFeature } from '../../../data/battlefield.js';
import {
  distancePointToBoundary,
  footprintDistanceToPolygon,
  footprintInsidePolygon,
  footprintOverlapsPolygon,
  footprintPolygon,
  pointInPolygon,
  polygonsOverlap,
  type Polygon,
} from '../../../geom/index.js';
import {
  COMBAT_RANGE,
  DIST_EPS,
  aliveIndices,
  hasKeyword,
  inCombat,
  modelFootprint,
  opponent,
  profileOf,
  unitFootprints,
  unitsOf,
} from '../../../engine/query.js';
import type {
  GameState,
  Phase,
  PlayerId,
  Scenario,
  TacticTier,
  UnitId,
  UnitState,
} from '../../../engine/types.js';
import { footprintToPoint } from '../objectives.js';

export const BATTLE_TACTIC_STEP_VP = 5;
export const BATTLE_TACTIC_VP = BATTLE_TACTIC_STEP_VP;

export const BLAZING_ONSLAUGHT_ID = '7d3c-b9b7-6412-d44e';
export const SIEGE_OF_ASHES_ID = 'f94b-bda7-237e-74be';
export const BURNING_FOR_VENGEANCE_ID = '2cf4-fa15-532b-64af';
export const LEGEND_OF_THE_PARCH_ID = 'c816-cb18-a434-8c1c';
export const FLANKING_FIRESTORM_ID = '7865-8113-df4e-f70a';
export const SMOKESCREEN_ID = '069b-7c31-ccb1-fcb5';

export type ActiveTacticTier = Exclude<TacticTier, 'completed'>;

export interface ScoredTactic {
  cardId: string;
  cardName: string;
  tier: ActiveTacticTier;
  tacticName: string;
  vp: number;
}

// ─── Territory & geometry helpers ──────────────────────────────────────────────

export function friendlyTerritories(scenario: Scenario, player: PlayerId): Polygon[] {
  return scenario.battlefield.territories[scenario.sides[player]];
}

export function enemyTerritories(scenario: Scenario, player: PlayerId): Polygon[] {
  return scenario.battlefield.territories[scenario.sides[opponent(player)]];
}

/** Regular battlefield units of `player` (excludes manifestations and faction terrain). */
export function eligibleArmyUnits(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  return unitsOf(state, player).filter((u) => {
    if (u.isManifestation) return false;
    const p = profileOf(scenario, u);
    return !p.isFactionTerrain && !p.isManifestation;
  });
}

/** True when every living model of `unit` lies wholly inside `polys`. */
export function unitWhollyWithinPolygons(
  scenario: Scenario,
  unit: UnitState,
  polys: readonly Polygon[],
): boolean {
  const fps = unitFootprints(scenario, unit);
  if (fps.length === 0 || polys.length === 0) return false;
  return fps.every((fp) => polys.some((poly) => footprintInsidePolygon(fp, poly)));
}

/** True when at least one living model of `unit` overlaps or lies inside `polys`. */
export function unitWithinPolygons(
  scenario: Scenario,
  unit: UnitState,
  polys: readonly Polygon[],
): boolean {
  const fps = unitFootprints(scenario, unit);
  if (fps.length === 0 || polys.length === 0) return false;
  return fps.some((fp) =>
    polys.some(
      (poly) =>
        footprintOverlapsPolygon(fp, poly) ||
        footprintInsidePolygon(fp, poly) ||
        footprintDistanceToPolygon(fp, poly) <= DIST_EPS,
    ),
  );
}

/** True when no living model of `unit` overlaps or lies inside `polys`. */
export function unitWhollyOutsidePolygons(
  scenario: Scenario,
  unit: UnitState,
  polys: readonly Polygon[],
): boolean {
  const fps = unitFootprints(scenario, unit);
  if (fps.length === 0 || polys.length === 0) return true;
  return !fps.some((fp) =>
    polys.some((poly) => footprintOverlapsPolygon(fp, poly) || footprintInsidePolygon(fp, poly)),
  );
}

/** True when no living model of `unit` overlaps friendly territory. */
export function unitWhollyOutsideFriendlyTerritory(
  scenario: Scenario,
  player: PlayerId,
  unit: UnitState,
): boolean {
  const fps = unitFootprints(scenario, unit);
  if (fps.length === 0) return false;
  const friendly = friendlyTerritories(scenario, player);
  return !fps.some((fp) => friendly.some((poly) => footprintOverlapsPolygon(fp, poly)));
}

/** Shortest edge-to-edge distance from any living model of `unit` to friendly territory. */
export function unitDistanceFromFriendlyTerritory(
  scenario: Scenario,
  player: PlayerId,
  unit: UnitState,
): number {
  const fps = unitFootprints(scenario, unit);
  if (fps.length === 0) return Infinity;
  const friendly = friendlyTerritories(scenario, player);
  let best = Infinity;
  for (const fp of fps) {
    for (const poly of friendly) {
      const d = footprintDistanceToPolygon(fp, poly);
      if (d < best) best = d;
    }
  }
  return best;
}

/** True when every living model of `unit` is wholly within `range` inches of friendly territory. */
export function unitWhollyWithinRangeOfFriendlyTerritory(
  scenario: Scenario,
  player: PlayerId,
  unit: UnitState,
  range: number,
): boolean {
  const fps = unitFootprints(scenario, unit);
  const friendly = friendlyTerritories(scenario, player);
  if (fps.length === 0 || friendly.length === 0) return false;
  return fps.every((fp) => {
    const pts = footprintPolygon(fp);
    return pts.every((pt) =>
      friendly.some(
        (poly) => pointInPolygon(pt, poly) || distancePointToBoundary(pt, poly) <= range + DIST_EPS,
      ),
    );
  });
}

/** True when `obj` is wholly outside `player`'s friendly territory. */
export function objectiveWhollyOutsideFriendlyTerritory(
  scenario: Scenario,
  player: PlayerId,
  obj: ObjectiveSpec,
): boolean {
  const friendly = friendlyTerritories(scenario, player);
  return !friendly.some((poly) => pointInPolygon([obj.x, obj.y], poly));
}

/** True when `obj` lies within `player`'s enemy territory (and not straddling friendly territory). */
export function objectiveInEnemyTerritory(
  scenario: Scenario,
  player: PlayerId,
  obj: ObjectiveSpec,
): boolean {
  const enemy = enemyTerritories(scenario, player);
  const friendly = friendlyTerritories(scenario, player);
  return (
    enemy.some((poly) => pointInPolygon([obj.x, obj.y], poly)) &&
    !friendly.some((poly) => pointInPolygon([obj.x, obj.y], poly))
  );
}

/** True when at least one living model of `unit` contests `obj`. */
export function unitContestsObjective(
  scenario: Scenario,
  unit: UnitState,
  obj: ObjectiveSpec,
): boolean {
  if (unit.status !== 'battlefield' || unit.isManifestation) return false;
  const profile = profileOf(scenario, unit);
  if (profile.isFactionTerrain || profile.isManifestation || profile.control <= 0) return false;
  return aliveIndices(unit).some(
    (i) =>
      footprintToPoint(modelFootprint(scenario, unit, i), obj.x, obj.y) <= obj.radius + DIST_EPS,
  );
}

/** True when at least one living model of `unit` contests `terrain` (within 3" of its footprint). */
export function unitContestsTerrain(
  scenario: Scenario,
  unit: UnitState,
  terrain: TerrainFeature,
): boolean {
  if (unit.status !== 'battlefield' || unit.isManifestation) return false;
  const profile = profileOf(scenario, unit);
  if (profile.isFactionTerrain || profile.isManifestation || profile.control <= 0) return false;
  return unitFootprints(scenario, unit).some(
    (fp) => footprintDistanceToPolygon(fp, terrain.polygon) <= COMBAT_RANGE + DIST_EPS,
  );
}

/**
 * True when `player` controls `terrain` (Core Rules 32.3): total Control characteristic of
 * `player`'s models within 3" of `terrain` exceeds the opponent's and is at least 1.
 */
export function controlsTerrain(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  terrain: TerrainFeature,
): boolean {
  const scoreFor = (p: PlayerId): number => {
    let total = 0;
    for (const u of eligibleArmyUnits(scenario, state, p)) {
      const profile = profileOf(scenario, u);
      if (profile.control <= 0) continue;
      for (const fp of unitFootprints(scenario, u)) {
        if (footprintDistanceToPolygon(fp, terrain.polygon) <= COMBAT_RANGE + DIST_EPS) {
          total += profile.control;
        }
      }
    }
    return total;
  };
  const mine = scoreFor(player);
  const theirs = scoreFor(opponent(player));
  return mine > 0 && mine > theirs;
}

// ─── Initialisation & per-turn tracking ────────────────────────────────────────

/**
 * Sets initial `tacticProgress` ('affray' for each chosen card) and the Blazing Onslaught
 * `hideoutTerrain`. The Burning for Vengeance fugitive is the player's choice: see
 * `needsFugitive` and the engine's `fugitive` decision.
 */
export function initBattleTactics(scenario: Scenario, state: GameState): void {
  for (const p of [0, 1] as PlayerId[]) {
    const pState = state.players[p];
    const cards = scenario.armies[p].tacticCards;
    pState.tacticProgress ??= {};
    for (const card of cards) {
      pState.tacticProgress[card.id] ??= 'affray';
    }

    if (cards.some((c) => c.id === BLAZING_ONSLAUGHT_ID) && !pState.hideoutTerrain) {
      const enemyPolys = enemyTerritories(scenario, p);
      const terrainInEnemy = scenario.battlefield.terrain.find((t) =>
        enemyPolys.some(
          (poly) => pointInPolygon(t.centre, poly) || polygonsOverlap(t.polygon, poly),
        ),
      );
      pState.hideoutTerrain = (terrainInEnemy ?? scenario.battlefield.terrain[0])?.id ?? null;
    }
  }
}

/** True when `player` has Burning for Vengeance and has not picked the fugitive yet. */
export function needsFugitive(scenario: Scenario, state: GameState, player: PlayerId): boolean {
  return (
    scenario.armies[player].tacticCards.some((c) => c.id === BURNING_FOR_VENGEANCE_ID) &&
    state.players[player].fugitiveUnit == null &&
    fugitiveCandidates(scenario, state, player).length > 0
  );
}

/** Enemy Heroes on the battlefield or in reserve that `player` may pick as the fugitive. */
export function fugitiveCandidates(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitId[] {
  const opp = opponent(player);
  return state.unitOrder.filter((id) => {
    const u = state.units[id]!;
    return (
      u.owner === opp &&
      u.status !== 'destroyed' &&
      !profileOf(scenario, u).isManifestation &&
      !profileOf(scenario, u).isFactionTerrain &&
      hasKeyword(scenario, u, 'HERO')
    );
  });
}

/**
 * A sensible fugitive: the candidate with the fewest effective wounds (wounds left divided by
 * the chance of failing its save), so it is easiest to hunt down, or to slay, which completes
 * Quick Pursuit outright.
 */
export function suggestFugitive(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitId | null {
  let best: UnitId | null = null;
  let bestScore = Infinity;
  for (const id of fugitiveCandidates(scenario, state, player)) {
    const u = state.units[id]!;
    const profile = profileOf(scenario, u);
    const wounds = profile.health * aliveIndices(u).length - u.damage;
    // Effective wounds: wounds divided by the chance an attack gets through the save.
    const failSave = (Math.min(7, Math.max(2, profile.save)) - 1) / 6;
    const score = wounds / failSave;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * Records start-of-turn snapshots needed by Battle Tactics (`turnStartObjectives`,
 * `turnStartInCombat`) and resets per-turn kill/damage tracking.
 */
export function recordTurnStartForTactics(scenario: Scenario, state: GameState): void {
  const objSnap: Record<string, PlayerId | null> = {};
  for (const o of state.objectives) {
    objSnap[o.id] = o.controller;
  }
  state.turnStartObjectives = objSnap;
  state.turnStartInCombat = state.unitOrder.filter((id) => {
    const u = state.units[id];
    return Boolean(u && u.status === 'battlefield' && inCombat(scenario, state, u));
  });
  state.destroyedByChargeCombat = [];
  state.unitsDestroyedThisTurn = [];
  state.damagedInPhases = {};
}

/** Records that `unitId` had at least 1 damage point allocated to it in `phase`. */
export function recordDamageAllocatedForTactics(
  state: GameState,
  unitId: UnitId,
  phase: Phase,
): void {
  state.damagedInPhases ??= {};
  const list = state.damagedInPhases[unitId] ?? [];
  if (!list.includes(phase)) {
    state.damagedInPhases[unitId] = [...list, phase];
  }
}

/**
 * Records that `unit` was destroyed this turn (excluding manifestations and faction terrain,
 * per Core Rules 1.5 and 7.0).
 */
export function recordUnitDestroyedForTactics(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  byChargingCombatUnit = false,
): void {
  if (unit.isManifestation) return;
  const profile = profileOf(scenario, unit);
  if (profile.isFactionTerrain || profile.isManifestation) return;
  state.unitsDestroyedThisTurn = [
    ...(state.unitsDestroyedThisTurn ?? []),
    { id: unit.id, owner: unit.owner, isHero: hasKeyword(scenario, unit, 'HERO') },
  ];
  if (byChargingCombatUnit) {
    state.destroyedByChargeCombat = [...(state.destroyedByChargeCombat ?? []), unit.id];
  }
}
