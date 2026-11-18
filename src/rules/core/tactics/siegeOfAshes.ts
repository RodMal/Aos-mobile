import { DIST_EPS, inCombat, unitFootprints, unitsWithin } from '../../../engine/query.js';
import type { GameState, PlayerId, Scenario } from '../../../engine/types.js';
import { footprintToPoint } from '../objectives.js';
import {
  type ActiveTacticTier,
  eligibleArmyUnits,
  objectiveInEnemyTerritory,
  unitContestsObjective,
  unitWhollyOutsideFriendlyTerritory,
  unitWhollyWithinRangeOfFriendlyTerritory,
} from './shared.js';

export function evaluateSiegeOfAshes(
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
