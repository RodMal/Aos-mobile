import { UNIVERSAL } from '../data/catalog.js';
import { INTO_THE_FIRE, type Battlefield } from '../data/battlefield.js';
import { resolveArmy, type ArmyList } from '../data/lists.js';
import type { Side } from '../data/map-schema.js';
import { buildProfile, type UnitProfile } from '../data/profile.js';
import { WYLDWOOD_PIECES } from '../data/wyldwood.js';
import type { Scenario } from './types.js';

export interface ScenarioOptions {
  battlefield?: Battlefield;
  /** Which player is the attacker (takes the battlefield's attacker side). Default 0. */
  attacker?: 0 | 1;
  rounds?: number;
}

/** Builds the static description of a game from two army lists. */
export function createScenario(
  lists: [ArmyList, ArmyList],
  options: ScenarioOptions = {},
): Scenario {
  const battlefield = options.battlefield ?? INTO_THE_FIRE;
  const armies: Scenario['armies'] = [resolveArmy(lists[0]), resolveArmy(lists[1])];
  const profiles: Record<string, UnitProfile> = {};
  for (const army of armies) {
    for (const unit of army.units) profiles[unit.profile.id] = unit.profile;
    if (army.factionTerrain) {
      const ft = army.factionTerrain;
      profiles[ft.id] = ft;
      // Further Awakened Wyldwood pieces use the other two traced outlines (src/data/wyldwood.ts).
      if (ft.name === 'Awakened Wyldwood') {
        for (const piece of [2, 3]) {
          profiles[`${ft.id}:piece${piece}`] = {
            ...ft,
            id: `${ft.id}:piece${piece}`,
            models: [
              {
                ...ft.models[0]!,
                base: WYLDWOOD_PIECES[piece - 1]!,
              },
            ],
          };
        }
      }
    }
  }
  for (const ws of UNIVERSAL.warscrolls) {
    if (ws.isManifestation && !profiles[ws.id]) {
      profiles[ws.id] = buildProfile(ws);
    }
  }
  const attackerSide = battlefield.attackerSide;
  const defenderSide: Side = attackerSide === 'A' ? 'B' : 'A';
  const attacker = options.attacker ?? 0;
  return {
    battlefield,
    armies,
    sides: attacker === 0 ? [attackerSide, defenderSide] : [defenderSide, attackerSide],
    profiles,
    rounds: options.rounds ?? 5,
  };
}
