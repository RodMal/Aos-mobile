import { enemiesWithin, hasKeyword, opponent } from '../../../engine/query.js';
import type { GameState, PlayerId, Scenario } from '../../../engine/types.js';
import {
  type ActiveTacticTier,
  eligibleArmyUnits,
  objectiveWhollyOutsideFriendlyTerritory,
  unitContestsObjective,
} from './shared.js';

export function evaluateLegendOfTheParch(
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
