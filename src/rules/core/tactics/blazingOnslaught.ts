import { opponent } from '../../../engine/query.js';
import type { GameState, PlayerId, Scenario } from '../../../engine/types.js';
import { type ActiveTacticTier, controlsTerrain } from './shared.js';

export function evaluateBlazingOnslaught(
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
