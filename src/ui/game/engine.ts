/** The scenario and engine the app plays (see src/game.ts), plus naming helpers for the UI. */
import { profileOf, type PlayerId, type UnitState } from '../../engine/index.js';
import { engine, scenario } from '../../game.js';
import { objectiveLabel, type LogContext } from './eventText.js';

export { engine, scenario };

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
