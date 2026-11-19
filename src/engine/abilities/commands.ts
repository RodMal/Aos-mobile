import { registerAbility } from './effects.js';
import type { AbilityDefinition } from './types.js';

/** Fury of The Forest (Sylvaneth battle trait command, 081a-ebf2-6a79-c4db). */
export const FURY_OF_THE_FOREST_ID = '081a-ebf2-6a79-c4db';

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
  {
    // The unit has Strike-first for the rest of the turn (the effect lasts until the turn ends).
    id: FURY_OF_THE_FOREST_ID,
    name: 'Fury of The Forest',
    kind: 'command',
    bsdata: true,
    effectGrants: () => ({ keywords: ['STRIKE-FIRST'] }),
  },
];

for (const def of COMMAND_ABILITIES) {
  registerAbility(def);
}
