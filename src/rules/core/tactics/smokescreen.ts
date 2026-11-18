import { opponent } from '../../../engine/query.js';
import type { GameState, PlayerId, Scenario } from '../../../engine/types.js';
import {
  type ActiveTacticTier,
  eligibleArmyUnits,
  objectiveInEnemyTerritory,
  unitContestsObjective,
} from './shared.js';

export function evaluateSmokescreen(
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
