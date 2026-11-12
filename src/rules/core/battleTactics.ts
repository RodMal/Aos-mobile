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
import type { ObjectiveSpec, TerrainFeature } from '../../data/battlefield.js';
import {
  distancePointToBoundary,
  footprintDistanceToPolygon,
  footprintInsidePolygon,
  footprintOverlapsPolygon,
  footprintPolygon,
  pointInPolygon,
  polygonsOverlap,
  type Polygon,
} from '../../geom/index.js';
import {
  COMBAT_RANGE,
  DIST_EPS,
  aliveIndices,
  enemiesWithin,
  hasKeyword,
  inCombat,
  modelFootprint,
  opponent,
  profileOf,
  unitFootprints,
  unitsOf,
  unitsWithin,
} from '../../engine/query.js';
import type {
  GameState,
  Phase,
  PlayerId,
  Scenario,
  TacticTier,
  UnitId,
  UnitState,
} from '../../engine/types.js';
import { footprintToPoint } from './objectives.js';

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
function eligibleArmyUnits(scenario: Scenario, state: GameState, player: PlayerId): UnitState[] {
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

// ─── Card evaluators ───────────────────────────────────────────────────────────

function evaluateFlankingFirestorm(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  tier: ActiveTacticTier,
): boolean {
  const friendlyUnits = eligibleArmyUnits(scenario, state, player);
  if (tier === 'affray') {
    // Ambuscade: 2 or more objectives or non-Faction Terrain terrain features that you control,
    // in any combination, are each contested by a different friendly unit that is more than 6"
    // from friendly territory and was not set up this turn.
    const eligible = friendlyUnits.filter(
      (u) =>
        !u.setUpThisTurn && unitDistanceFromFriendlyTerritory(scenario, player, u) > 6 + DIST_EPS,
    );
    if (eligible.length < 2) return false;

    const targetContesting: UnitId[][] = [];
    for (const objSpec of scenario.battlefield.objectives) {
      const ctrl = state.objectives.find((o) => o.id === objSpec.id)?.controller;
      if (ctrl !== player) continue;
      const units = eligible
        .filter((u) => unitContestsObjective(scenario, u, objSpec))
        .map((u) => u.id);
      if (units.length > 0) targetContesting.push(units);
    }
    for (const terrain of scenario.battlefield.terrain) {
      if (!controlsTerrain(scenario, state, player, terrain)) continue;
      const units = eligible
        .filter((u) => unitContestsTerrain(scenario, u, terrain))
        .map((u) => u.id);
      if (units.length > 0) targetContesting.push(units);
    }
    if (targetContesting.length < 2) return false;

    const match = (idx: number, used: Set<UnitId>, matched: number): boolean => {
      if (matched >= 2) return true;
      if (idx >= targetContesting.length) return false;
      if (targetContesting.length - idx < 2 - matched) return false;
      for (const uid of targetContesting[idx]!) {
        if (used.has(uid)) continue;
        used.add(uid);
        if (match(idx + 1, used, matched + 1)) return true;
        used.delete(uid);
      }
      return match(idx + 1, used, matched);
    };
    return match(0, new Set(), 0);
  }

  if (tier === 'strike') {
    // Surround the Enemy: 2 or more friendly units that were not set up this turn are each
    // within 9" of a different corner of the battlefield and wholly outside friendly territory.
    const eligible = friendlyUnits.filter(
      (u) => !u.setUpThisTurn && unitWhollyOutsideFriendlyTerritory(scenario, player, u),
    );
    if (eligible.length < 2) return false;
    const w = scenario.battlefield.width;
    const h = scenario.battlefield.height;
    const corners: [number, number][] = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    const perCorner = corners.map(([cx, cy]) =>
      eligible
        .filter((u) =>
          unitFootprints(scenario, u).some((fp) => footprintToPoint(fp, cx, cy) <= 9 + DIST_EPS),
        )
        .map((u) => u.id),
    );
    const matchCorner = (ci: number, used: Set<UnitId>, matched: number): boolean => {
      if (matched >= 2) return true;
      if (ci >= perCorner.length) return false;
      for (const uid of perCorner[ci]!) {
        if (used.has(uid)) continue;
        used.add(uid);
        if (matchCorner(ci + 1, used, matched + 1)) return true;
        used.delete(uid);
      }
      return matchCorner(ci + 1, used, matched);
    };
    return matchCorner(0, new Set(), 0);
  }

  // Domination — Claim What's Yours: more friendly units within enemy territory than enemy
  // units, and at least 1 friendly Hero wholly within enemy territory.
  const enemyPolys = enemyTerritories(scenario, player);
  const mineInEnemy = friendlyUnits.filter((u) => unitWithinPolygons(scenario, u, enemyPolys));
  const theirsInEnemy = eligibleArmyUnits(scenario, state, opponent(player)).filter((u) =>
    unitWithinPolygons(scenario, u, enemyPolys),
  );
  if (mineInEnemy.length <= theirsInEnemy.length) return false;
  return friendlyUnits.some(
    (u) => hasKeyword(scenario, u, 'HERO') && unitWhollyWithinPolygons(scenario, u, enemyPolys),
  );
}

function evaluateBurningForVengeance(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  tier: ActiveTacticTier,
): boolean {
  const friendlyUnits = eligibleArmyUnits(scenario, state, player);
  const cx = scenario.battlefield.width / 2;
  const cy = scenario.battlefield.height / 2;

  if (tier === 'affray') {
    // Search Every Inch: a different friendly unit wholly within each large quarter of the
    // battlefield, each more than 9" from the centre, and at most 1 set up this turn.
    const w = scenario.battlefield.width;
    const h = scenario.battlefield.height;
    const quarters: Polygon[] = [
      [
        [0, 0],
        [cx, 0],
        [cx, cy],
        [0, cy],
      ],
      [
        [cx, 0],
        [w, 0],
        [w, cy],
        [cx, cy],
      ],
      [
        [0, cy],
        [cx, cy],
        [cx, h],
        [0, h],
      ],
      [
        [cx, cy],
        [w, cy],
        [w, h],
        [cx, h],
      ],
    ];
    const farFromCentre = friendlyUnits.filter((u) => {
      const fps = unitFootprints(scenario, u);
      return fps.length > 0 && fps.every((fp) => footprintToPoint(fp, cx, cy) > 9 + DIST_EPS);
    });
    const perQuarter = quarters.map((q) =>
      farFromCentre.filter((u) => unitWhollyWithinPolygons(scenario, u, [q])),
    );
    const assign = (qi: number, used: Set<UnitId>, setUpCount: number): boolean => {
      if (qi >= 4) return true;
      for (const u of perQuarter[qi]!) {
        if (used.has(u.id)) continue;
        const nextSetUp = setUpCount + (u.setUpThisTurn ? 1 : 0);
        if (nextSetUp > 1) continue;
        used.add(u.id);
        if (assign(qi + 1, used, nextSetUp)) return true;
        used.delete(u.id);
      }
      return false;
    };
    return assign(0, new Set(), 0);
  }

  const fugitiveId = state.players[player].fugitiveUnit;
  const fugitive = fugitiveId ? state.units[fugitiveId] : undefined;
  const fugitiveOnBoard = fugitive && fugitive.status === 'battlefield' ? fugitive : null;

  if (tier === 'strike') {
    // Quick Pursuit: 3+ friendly units not in combat within 12" of the enemy fugitive,
    // OR no enemy fugitive on the battlefield.
    if (!fugitiveOnBoard) return true;
    return (
      friendlyUnits.filter(
        (u) => !inCombat(scenario, state, u) && unitsWithin(scenario, u, fugitiveOnBoard, 12),
      ).length >= 3
    );
  }

  // Domination — Bring Them In: 3+ friendly units in combat with the enemy fugitive,
  // OR no enemy fugitive on the battlefield and 3+ friendly units contesting the same
  // objective wholly outside friendly territory.
  if (fugitiveOnBoard) {
    return (
      friendlyUnits.filter((u) => unitsWithin(scenario, u, fugitiveOnBoard, COMBAT_RANGE)).length >=
      3
    );
  }
  return scenario.battlefield.objectives.some(
    (obj) =>
      objectiveWhollyOutsideFriendlyTerritory(scenario, player, obj) &&
      friendlyUnits.filter((u) => unitContestsObjective(scenario, u, obj)).length >= 3,
  );
}

function evaluateSiegeOfAshes(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  tier: ActiveTacticTier,
): boolean {
  const friendlyUnits = eligibleArmyUnits(scenario, state, player);

  if (tier === 'affray') {
    // Form a Wall: 2 or more friendly units are wholly outside friendly territory,
    // wholly within 6" of friendly territory and within 3" of each other.
    const candidates = friendlyUnits.filter(
      (u) =>
        unitWhollyOutsideFriendlyTerritory(scenario, player, u) &&
        unitWhollyWithinRangeOfFriendlyTerritory(scenario, player, u, 6),
    );
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (unitsWithin(scenario, candidates[i]!, candidates[j]!, 3)) return true;
      }
    }
    return false;
  }

  if (tier === 'strike') {
    // Outpost Territory: control an objective within enemy territory contested by at least
    // 1 friendly unit that did not use a Move ability this turn and at least 1 other friendly
    // unit that charged this turn.
    return scenario.battlefield.objectives.some((obj) => {
      const ctrl = state.objectives.find((o) => o.id === obj.id)?.controller;
      if (ctrl !== player) return false;
      if (!objectiveInEnemyTerritory(scenario, player, obj)) return false;
      const contesting = friendlyUnits.filter((u) => unitContestsObjective(scenario, u, obj));
      const stationary = contesting.filter((u) => u.moved === null && !u.charged);
      const chargers = contesting.filter((u) => u.charged);
      return stationary.some((s) => chargers.some((c) => c.id !== s.id));
    });
  }

  // Domination — Repel the Attackers: 3 or more friendly units within 3" of the centre of
  // the battlefield that are not in combat.
  const cx = scenario.battlefield.width / 2;
  const cy = scenario.battlefield.height / 2;
  return (
    friendlyUnits.filter(
      (u) =>
        !inCombat(scenario, state, u) &&
        unitFootprints(scenario, u).some((fp) => footprintToPoint(fp, cx, cy) <= 3 + DIST_EPS),
    ).length >= 3
  );
}

function evaluateLegendOfTheParch(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  tier: ActiveTacticTier,
): boolean {
  const friendlyUnits = eligibleArmyUnits(scenario, state, player);
  const opp = opponent(player);

  if (tier === 'affray') {
    // Daring Rescue: an enemy unit that was in combat at the start of the turn was destroyed
    // by a combat attack made by a friendly unit that charged this turn.
    const startInCombat = state.turnStartInCombat ?? [];
    const destroyedByCharge = state.destroyedByChargeCombat ?? [];
    return destroyedByCharge.some(
      (id) => startInCombat.includes(id) && (state.units[id]?.owner ?? opp) === opp,
    );
  }

  if (tier === 'strike') {
    // Command from the Front: 2+ friendly Heroes on the battlefield, all friendly Heroes
    // are within 9" of a visible enemy unit, and no friendly Heroes were slain this turn.
    const heroes = friendlyUnits.filter((u) => hasKeyword(scenario, u, 'HERO'));
    if (heroes.length < 2) return false;
    if ((state.unitsDestroyedThisTurn ?? []).some((d) => d.owner === player && d.isHero)) {
      return false;
    }
    return heroes.every((h) => enemiesWithin(scenario, state, h, 9).length > 0);
  }

  // Domination — Hero of Legend: control an objective wholly outside your territory that you
  // did not control at the start of the turn and a friendly Hero is contesting that objective.
  const heroes = friendlyUnits.filter((u) => hasKeyword(scenario, u, 'HERO'));
  if (heroes.length === 0) return false;
  return scenario.battlefield.objectives.some((obj) => {
    const ctrl = state.objectives.find((o) => o.id === obj.id)?.controller;
    if (ctrl !== player) return false;
    if (!objectiveWhollyOutsideFriendlyTerritory(scenario, player, obj)) return false;
    if (state.turnStartObjectives?.[obj.id] === player) return false;
    return heroes.some((h) => unitContestsObjective(scenario, h, obj));
  });
}

function evaluateBlazingOnslaught(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  tier: ActiveTacticTier,
): boolean {
  const opp = opponent(player);

  if (tier === 'affray') {
    // Master of Arms: the same enemy unit had at least 1 damage point allocated to it in
    // 3 different phases this turn.
    const damaged = state.damagedInPhases ?? {};
    for (const [unitId, phases] of Object.entries(damaged)) {
      const unitOwner = state.units[unitId]?.owner ?? opp;
      if (unitOwner === opp && new Set(phases).size >= 3) {
        return true;
      }
    }
    return false;
  }

  const hideoutId = state.players[player].hideoutTerrain;
  const hideout = hideoutId
    ? scenario.battlefield.terrain.find((t) => t.id === hideoutId)
    : undefined;

  if (tier === 'strike') {
    // Break Their Defences: control the enemy hideout.
    return Boolean(hideout && controlsTerrain(scenario, state, player, hideout));
  }

  // Domination — No Survivors: 2 or more enemy units were destroyed this turn and you
  // control the enemy hideout.
  const enemyDestroyed = (state.unitsDestroyedThisTurn ?? []).filter((d) => d.owner === opp).length;
  if (enemyDestroyed < 2) return false;
  return Boolean(hideout && controlsTerrain(scenario, state, player, hideout));
}

function evaluateSmokescreen(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  tier: ActiveTacticTier,
): boolean {
  const opp = opponent(player);

  if (tier === 'affray') {
    // Keep the Enemy Close: control an objective that is contested by at least 1 enemy unit.
    const enemyUnits = eligibleArmyUnits(scenario, state, opp);
    return scenario.battlefield.objectives.some((obj) => {
      const ctrl = state.objectives.find((o) => o.id === obj.id)?.controller;
      if (ctrl !== player) return false;
      return enemyUnits.some((e) => unitContestsObjective(scenario, e, obj));
    });
  }

  if (tier === 'strike') {
    // Feign Weakness: more friendly units were destroyed this turn than enemy units.
    const destroyed = state.unitsDestroyedThisTurn ?? [];
    const myLoss = destroyed.filter((d) => d.owner === player).length;
    const theirLoss = destroyed.filter((d) => d.owner === opp).length;
    return myLoss > theirLoss;
  }

  // Domination — Execute the Plan: control each objective within enemy territory.
  const enemyObjs = scenario.battlefield.objectives.filter((obj) =>
    objectiveInEnemyTerritory(scenario, player, obj),
  );
  if (enemyObjs.length === 0) return false;
  return enemyObjs.every(
    (obj) => state.objectives.find((o) => o.id === obj.id)?.controller === player,
  );
}

/** Evaluates a single Battle Tactic card tier for `player`. */
export function evaluateBattleTactic(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  cardId: string,
  tier: ActiveTacticTier,
): boolean {
  switch (cardId) {
    case FLANKING_FIRESTORM_ID:
      return evaluateFlankingFirestorm(scenario, state, player, tier);
    case BURNING_FOR_VENGEANCE_ID:
      return evaluateBurningForVengeance(scenario, state, player, tier);
    case SIEGE_OF_ASHES_ID:
      return evaluateSiegeOfAshes(scenario, state, player, tier);
    case LEGEND_OF_THE_PARCH_ID:
      return evaluateLegendOfTheParch(scenario, state, player, tier);
    case BLAZING_ONSLAUGHT_ID:
      return evaluateBlazingOnslaught(scenario, state, player, tier);
    case SMOKESCREEN_ID:
      return evaluateSmokescreen(scenario, state, player, tier);
    default:
      return false;
  }
}

function nextTier(tier: ActiveTacticTier): TacticTier {
  if (tier === 'affray') return 'strike';
  if (tier === 'strike') return 'domination';
  return 'completed';
}

function tacticSectionName(
  sections: { name: string; text: string }[],
  tier: ActiveTacticTier,
): string {
  const want = tier.toLowerCase();
  const sec = sections.find((s) => s.name.toLowerCase() === want);
  if (!sec) return tier;
  const colonIdx = sec.text.indexOf(':');
  return colonIdx > 0 ? sec.text.slice(0, colonIdx).trim() : sec.name;
}

/**
 * Evaluates both of `player`'s Battle Tactic cards at the end of their turn, advances
 * `player.tacticProgress` for each completed step, and returns the scored tactics.
 *
 * A player who seized the initiative this round cannot score any battle tactic on that turn.
 */
export function evaluateEndOfTurnTactics(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): ScoredTactic[] {
  if (state.seizedThisRound === player && state.turnIndex === 0) {
    return [];
  }
  const pState = state.players[player];
  pState.tacticProgress ??= {};
  const out: ScoredTactic[] = [];

  for (const card of scenario.armies[player].tacticCards) {
    const current = pState.tacticProgress[card.id] ?? 'affray';
    if (current === 'completed') continue;
    if (evaluateBattleTactic(scenario, state, player, card.id, current)) {
      pState.tacticProgress[card.id] = nextTier(current);
      out.push({
        cardId: card.id,
        cardName: card.name,
        tier: current,
        tacticName: tacticSectionName(card.sections, current),
        vp: BATTLE_TACTIC_STEP_VP,
      });
    }
  }
  return out;
}
