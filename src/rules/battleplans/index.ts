/**
 * Battleplan-specific rules (GHB 2026-27). Each battleplan defines scoring and twist abilities.
 */
import type { ObjectiveSpec } from '../../data/battlefield.js';
import { terrainController } from '../../engine/terrain.js';
import type { GameState, PlayerId, Scenario, UnitState } from '../../engine/types.js';
import type { AttackSituation, Modifier } from '../core/modifiers.js';
import { contestedObjective, controlledCount } from '../core/objectives.js';
import { underdog } from '../core/round.js';
import { enemyTerritories, unitWhollyOutsidePolygons } from '../core/battleTactics.js';

export interface ScoreLine {
  vp: number;
  reason: string;
}

export interface BattleplanRules {
  id: string;
  name: string;
  /** VP the player whose turn is ending scores, given objective control at that moment. */
  endOfTurnScore(state: GameState, player: PlayerId): ScoreLine[];
  /** Attack modifiers for battleplan twists (e.g. Secure the Gateway). */
  attackModifiers?(scenario: Scenario, state: GameState, a: AttackSituation): Modifier[];
  /** Control bonus for battleplan twists (e.g. Determined Defenders). */
  controlBonus?(
    scenario: Scenario,
    state: GameState,
    unit: UnitState,
    objective: ObjectiveSpec,
  ): number;
}

/**
 * GHB 2026-27 Into the Fire (card 1-1):
 * - Scoring: 3VP for at least 1 objective, 3VP for 2 or more, 4VP for more objectives than opponent.
 * - Secure the Gateway: While you control the Place of Power wholly within friendly territory,
 *   friendly units' melee weapons have Anti-charge (+1 Rend) while contesting an objective you control.
 * - Determined Defenders: While you are the underdog, add 3 to control scores of friendly units
 *   wholly outside enemy territory.
 */
export const INTO_THE_FIRE_RULES: BattleplanRules = {
  id: 'into-the-fire',
  name: 'Into the Fire',
  endOfTurnScore(state, player) {
    const mine = controlledCount(state, player);
    const theirs = controlledCount(state, player === 0 ? 1 : 0);
    const out: ScoreLine[] = [];
    if (mine >= 1) out.push({ vp: 3, reason: 'Controls at least 1 objective' });
    if (mine >= 2) out.push({ vp: 3, reason: 'Controls 2 or more objectives' });
    if (mine > theirs) out.push({ vp: 4, reason: 'Controls more objectives than the opponent' });
    return out;
  },

  attackModifiers(scenario, state, a) {
    if (a.mode !== 'fight' || !a.target.charged) return [];
    const player = a.attacker.owner;

    // Place of power wholly in friendly territory:
    // Player 0 (Side B) -> 'spire-w'; Player 1 (Side A) -> 'spire-e'
    const popId = scenario.sides[player] === 'B' ? 'spire-w' : 'spire-e';
    const pop = scenario.battlefield.terrain.find((t) => t.id === popId);
    if (!pop || terrainController(scenario, state, pop) !== player) return [];

    // Friendly unit must be contesting an objective that player controls
    const contestsControlledObjective = a.attacker.models.some((m, idx) => {
      if (!m.alive) return false;
      const obj = contestedObjective(scenario, a.attacker, idx);
      if (!obj) return false;
      return state.objectives.find((o) => o.id === obj.id)?.controller === player;
    });

    if (!contestsControlledObjective) return [];

    return [
      {
        stat: 'rend',
        value: 1,
        source: 'Secure the Gateway (Anti-charge)',
        appliesToCompanion: true,
      },
    ];
  },

  controlBonus(scenario, state, unit, _objective) {
    if (underdog(state) !== unit.owner) return 0;
    const enemyPolys = enemyTerritories(scenario, unit.owner);
    // Wholly outside enemy territory
    if (unitWhollyOutsidePolygons(scenario, unit, enemyPolys)) {
      return 3;
    }
    return 0;
  },
};

const BATTLEPLANS: Record<string, BattleplanRules> = {
  [INTO_THE_FIRE_RULES.id]: INTO_THE_FIRE_RULES,
};

/** The rules for a battlefield id; falls back to Into the Fire's. */
export function battleplanRules(battlefieldId: string): BattleplanRules {
  return BATTLEPLANS[battlefieldId] ?? INTO_THE_FIRE_RULES;
}
