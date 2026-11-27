/**
 * The registered definitions of the manifestation abilities (M4l): the modifiers and grants of
 * Mechanisms of Time (Decrease Time Flow), Pull of the Nadir and Bound for the Great Oubliette
 * (the Move reduction), and the abilities whose behaviour lives in the engine. Kept apart from
 * `manifestations.ts` (helpers and constants) so that `damage.ts` can import those without
 * pulling in the registry.
 */
import type { Modifier } from '../../rules/core/modifiers.js';
import { hasKeyword, profileOf, unitWhollyWithin, unitsWithin } from '../query.js';
import { registerAbility } from './effects.js';
import {
  BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
  DANCING_BLADES_ID,
  MECHANISMS_AREA,
  MECHANISMS_OF_TIME_ID,
  MORBID_DETONATION_ID,
  MULTIPLE_PARTS_ID,
  NADIR_RANGE,
  NECROTIC_VORTEX_ID,
  PULL_OF_THE_NADIR_ID,
} from './manifestations.js';
import type { AbilityDefinition } from './types.js';

export const MANIFESTATION_ABILITIES: AbilityDefinition[] = [
  {
    // Decrease Time Flow: -1 to hit rolls for attacks that target the owner's Wizards that are
    // wholly within 12" of the Cogs. (Increase Time Flow, the charge re-roll, is `timeFlowReroll`.)
    id: MECHANISMS_OF_TIME_ID,
    name: 'Mechanisms of Time',
    kind: 'activated',
    bsdata: true,
    effectModifiers: (effect, sit, scenario, state): Modifier[] => {
      if (effect.data?.mode !== 'decrease') return [];
      const source = state.units[effect.sourceUnit];
      if (!source || source.status !== 'battlefield') return [];
      const target = sit.target;
      if (target.owner !== effect.owner || !hasKeyword(scenario, target, 'WIZARD')) return [];
      return unitWhollyWithin(scenario, source, target, MECHANISMS_AREA)
        ? [{ stat: 'hit', value: -1, source: 'Decrease Time Flow' }]
        : [];
    },
  },
  { id: DANCING_BLADES_ID, name: 'Dancing Blades', kind: 'passive', bsdata: true },
  {
    id: PULL_OF_THE_NADIR_ID,
    name: 'Pull of the Nadir',
    kind: 'passive',
    bsdata: true,
    // Every unit within 3" of the Sun, friendly and enemy, but not the Sun itself.
    areaModifiers: (source, sit, scenario): Modifier[] =>
      sit.target.id !== source.id &&
      !profileOf(scenario, sit.target).isFactionTerrain &&
      unitsWithin(scenario, source, sit.target, NADIR_RANGE)
        ? [{ stat: 'save', value: -1, source: 'Pull of the Nadir' }]
        : [],
  },
  { id: MORBID_DETONATION_ID, name: 'Morbid Detonation', kind: 'activated', bsdata: true },
  { id: NECROTIC_VORTEX_ID, name: 'Necrotic Vortex', kind: 'passive', bsdata: true },
  {
    // "Subtract a number of inches equal to the roll from the target's Move characteristic for the
    // rest of the turn": the effect carries the roll.
    id: BOUND_FOR_THE_GREAT_OUBLIETTE_ID,
    name: 'Bound for the Great Oubliette',
    kind: 'activated',
    bsdata: true,
    effectGrants: (effect) => ({ moveBonus: -Number(effect.data?.amount ?? 0) }),
  },
  { id: MULTIPLE_PARTS_ID, name: 'Multiple Parts', kind: 'passive', bsdata: true },
];

for (const def of MANIFESTATION_ABILITIES) registerAbility(def);
