import { registerAbility } from './effects.js';
import type { AbilityDefinition } from './types.js';

export const COMMAND_ABILITIES: AbilityDefinition[] = [
  {
    id: 'allOutAttack',
    name: 'All-out Attack',
    kind: 'command',
    effectModifiers: (eff, sit) => {
      if (eff.targetUnit !== sit.attacker.id) return [];
      return [{ stat: 'hit', value: 1, source: 'All-out Attack', appliesToCompanion: true }];
    },
  },
  {
    id: 'allOutDefence',
    name: 'All-out Defence',
    kind: 'command',
    effectModifiers: (eff, sit) => {
      if (eff.targetUnit !== sit.target.id) return [];
      return [{ stat: 'save', value: 1, source: 'All-out Defence' }];
    },
  },
  {
    id: 'coveringFire',
    name: 'Covering Fire',
    kind: 'command',
    effectModifiers: (eff, sit) => {
      if (eff.targetUnit !== sit.attacker.id) return [];
      return [{ stat: 'hit', value: -1, source: 'Covering Fire', appliesToCompanion: true }];
    },
  },
];

for (const def of COMMAND_ABILITIES) {
  registerAbility(def);
}
