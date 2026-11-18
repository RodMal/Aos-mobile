import { DIST_EPS, hasKeyword, opponent, unitFootprints } from '../../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitId } from '../../../engine/types.js';
import { footprintToPoint } from '../objectives.js';
import {
  type ActiveTacticTier,
  controlsTerrain,
  eligibleArmyUnits,
  enemyTerritories,
  unitContestsObjective,
  unitContestsTerrain,
  unitDistanceFromFriendlyTerritory,
  unitWhollyOutsideFriendlyTerritory,
  unitWhollyWithinPolygons,
  unitWithinPolygons,
} from './shared.js';

export function evaluateFlankingFirestorm(
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
