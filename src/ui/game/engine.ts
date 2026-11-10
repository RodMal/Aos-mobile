/** The one scenario and engine the app plays. Sylvaneth are player 0, Seraphon player 1. */
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import {
  createEngine,
  createScenario,
  profileOf,
  type PlayerId,
  type UnitState,
} from '../../engine/index.js';
import { objectiveLabel, type LogContext } from './eventText.js';

export const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
export const engine = createEngine(scenario);

export function playerName(p: PlayerId): string {
  return scenario.armies[p].factionName;
}

export function profileFor(unit: UnitState) {
  return profileOf(scenario, unit);
}

/** Names for the log, resolved against a state's units. */
export function logContext(units: Record<string, UnitState>): LogContext {
  return {
    unitName: (id) => units[id]?.name ?? id,
    playerName,
    weaponName: (attacker, weapon) => {
      const u = units[attacker];
      const w = u ? profileOf(scenario, u).weapons.find((x) => x.id === weapon) : undefined;
      return w?.name ?? weapon;
    },
    objectiveName: objectiveLabel,
  };
}
