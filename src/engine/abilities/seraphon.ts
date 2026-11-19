/**
 * Seraphon passive abilities (task M4f): Brutal Blows, Starspawned, Scaled Protectors,
 * Beastmaster, Selfless Protectors, Revivifying Energies and Ordered Cohorts. Hand-written and
 * keyed by BSData id. Readings: docs/RULES-DECISIONS.md I100 to I102.
 */
import { contestedObjective } from '../../rules/core/objectives.js';
import {
  aliveCount,
  aliveIndices,
  COMBAT_RANGE,
  hasKeyword,
  profileOf,
  unitWhollyWithin,
  unitsOf,
  unitsWithin,
} from '../query.js';
import type { Scenario, UnitState } from '../types.js';
import { registerAbility } from './effects.js';
import { STARSPAWNED_ID } from '../starspawned.js';
import type { AbilityDefinition } from './types.js';

export const BRUTAL_BLOWS_ID = '786b-b219-e23-42f8';
export const SCALED_PROTECTORS_ID = '3ffa-e9b3-901b-8d06';
export const BEASTMASTER_ID = '5e50-d938-39d2-19a6';
export const SELFLESS_PROTECTORS_ID = 'e49d-3d7e-2eee-a5e0';
export const REVIVIFYING_ENERGIES_ID = '15e-ebba-9386-bd1a';
export const ORDERED_COHORTS_ID = '4181-bbd5-a4d8-1f59';

const isFriend = (scenario: Scenario, source: UnitState, unit: UnitState): boolean =>
  unit.owner === source.owner && !profileOf(scenario, unit).isFactionTerrain;

export const SERAPHON_PASSIVES: AbilityDefinition[] = [
  {
    id: BRUTAL_BLOWS_ID,
    name: 'Brutal Blows',
    kind: 'passive',
    bsdata: true,
    offenceModifiers: (_self, sit) =>
      sit.mode === 'fight' && aliveCount(sit.target) >= 10
        ? [{ stat: 'damage', value: 1, source: 'Brutal Blows' }]
        : [],
  },
  // The first damage point of each phase is ignored by `applyStarspawned` (starspawned.ts).
  { id: STARSPAWNED_ID, name: 'Starspawned', kind: 'passive', bsdata: true },
  {
    id: SCALED_PROTECTORS_ID,
    name: 'Scaled Protectors',
    kind: 'passive',
    bsdata: true,
    passiveGrants: () => ({ ignoreSaveModifiers: true }),
  },
  {
    id: BEASTMASTER_ID,
    name: 'Beastmaster',
    kind: 'passive',
    bsdata: true,
    auraGrants: (source, unit, scenario) =>
      isFriend(scenario, source, unit) &&
      hasKeyword(scenario, unit, 'SERAPHON') &&
      (hasKeyword(scenario, unit, 'CAVALRY') || hasKeyword(scenario, unit, 'MONSTER')) &&
      unitWhollyWithin(scenario, source, unit, 12)
        ? { moveBonus: 2 }
        : {},
  },
  {
    id: SELFLESS_PROTECTORS_ID,
    name: 'Selfless Protectors',
    kind: 'passive',
    bsdata: true,
    // The unit has the ward while a friendly Slann is in its combat range, and so does each
    // such Slann. (The source is offered itself: it needs a Slann in range.)
    auraGrants: (source, unit, scenario, state) => {
      if (!isFriend(scenario, source, unit)) return {};
      if (unit.id === source.id) {
        return unitsOf(state, source.owner).some(
          (o) => hasKeyword(scenario, o, 'SLANN') && unitsWithin(scenario, source, o, COMBAT_RANGE),
        )
          ? { ward: 5 }
          : {};
      }
      return hasKeyword(scenario, unit, 'SLANN') &&
        unitsWithin(scenario, source, unit, COMBAT_RANGE)
        ? { ward: 5 }
        : {};
    },
  },
  {
    id: REVIVIFYING_ENERGIES_ID,
    name: 'Revivifying Energies',
    kind: 'passive',
    bsdata: true,
    auraGrants: (source, unit, scenario) => {
      if (
        !isFriend(scenario, source, unit) ||
        !hasKeyword(scenario, unit, 'SERAPHON') ||
        !hasKeyword(scenario, unit, 'INFANTRY') ||
        !unitWhollyWithin(scenario, source, unit, 12)
      ) {
        return {};
      }
      return { ward: profileOf(scenario, unit).ward === 6 ? 5 : 6 };
    },
  },
  {
    id: ORDERED_COHORTS_ID,
    name: 'Ordered Cohorts',
    kind: 'passive',
    bsdata: true,
    defenceModifiers: (self, _sit, scenario, state) => {
      const alive = aliveIndices(self);
      if (alive.length === 0) return [];
      const every = alive.every((i) => {
        const o = contestedObjective(scenario, self, i);
        return o !== null && state.objectives.find((x) => x.id === o.id)?.controller === self.owner;
      });
      return every ? [{ stat: 'save', value: 1, source: 'Ordered Cohorts' }] : [];
    },
  },
];

for (const def of SERAPHON_PASSIVES) registerAbility(def);
