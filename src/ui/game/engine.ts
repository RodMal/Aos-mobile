/** The scenario and engine the app plays (see src/game.ts), plus naming helpers for the UI. */
import { LORES, UNIVERSAL } from '../../data/catalog.js';
import type { Ability } from '../../data/schema/index.js';
import { profileOf, type PlayerId, type UnitState } from '../../engine/index.js';
import { engine, scenario } from '../../game.js';
import { objectiveLabel, type LogContext } from './eventText.js';

export { engine, scenario };

const abilityIndex = new Map<string, Ability>();
for (const lore of LORES) for (const a of lore.abilities) abilityIndex.set(a.id, a);
for (const w of UNIVERSAL.warscrolls) for (const a of w.abilities) abilityIndex.set(a.id, a);
for (const army of scenario.armies) {
  for (const a of [...army.battleTraits, ...army.formation.abilities]) abilityIndex.set(a.id, a);
  for (const u of army.units) {
    for (const a of u.profile.abilities) abilityIndex.set(a.id, a);
    for (const e of u.enhancements) abilityIndex.set(e.ability.id, e.ability);
  }
}

/** The printed ability with this BSData id, if the data has one. */
export function findAbility(id: string): Ability | null {
  return abilityIndex.get(id) ?? null;
}

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
