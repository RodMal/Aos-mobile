/**
 * Seraphon passive abilities (task M4f): Brutal Blows, Starspawned, Scaled Protectors,
 * Beastmaster, Selfless Protectors, Revivifying Energies and Ordered Cohorts; and the activated
 * abilities of task M4h (their effects; who may use them is in `../seraphonActive.ts`).
 * Hand-written and keyed by BSData id. Readings: docs/RULES-DECISIONS.md I100 to I105.
 */
import type { Weapon } from '../../data/profile.js';
import { contestedObjective } from '../../rules/core/objectives.js';
import { CELESTIAL_CONDUIT_ID } from '../../rules/factions/conduit.js';
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
import type { GameState, Scenario, UnitState } from '../types.js';
import { abilitiesOf, addEffect, registerAbility } from './effects.js';
import {
  FIERCE_GUARDIANS_ID,
  POWER_UNLEASHED_ID,
  fierceGuardiansModifiers,
} from '../factionTerrainActive.js';
import { STARSPAWNED_ID } from '../starspawned.js';
import type { AbilityDefinition } from './types.js';

export const BRUTAL_BLOWS_ID = '786b-b219-e23-42f8';
export const SCALED_PROTECTORS_ID = '3ffa-e9b3-901b-8d06';
export const BEASTMASTER_ID = '5e50-d938-39d2-19a6';
export const SELFLESS_PROTECTORS_ID = 'e49d-3d7e-2eee-a5e0';
export const REVIVIFYING_ENERGIES_ID = '15e-ebba-9386-bd1a';
export const ORDERED_COHORTS_ID = '4181-bbd5-a4d8-1f59';

// M4h: activated abilities.
export const VENOMITE_SWARM_ID = 'cf2e-d237-9320-1105';
export const SCRY_THE_STARS_ID = 'b8a5-8e24-ad08-d213';
export const COATL_FAMILIAR_ID = '2302-6d4-c346-7bc6';
export const ARK_OF_SOTEK_ID = '714c-4cb6-fce8-6ef9';
export const ARMOUR_CRUNCHER_ID = 'f6fe-3e8d-dd90-00b8';
export const STAR_VENOM_ID = 'c71d-2217-fcf1-6110';
export const HIDDEN_HUNTERS_ID = 'c78e-71e9-a948-fb09';
export const CHAMELEON_AMBUSH_ID = '4a89-1c50-df0e-4b2b';
export { CELESTIAL_CONDUIT_ID };
/** An effect (not an ability): the target had damage allocated by the unit's Dartpipe this turn. */
export const DARTPIPE_DAMAGE_ID = 'star-venom:dartpipe-damage';

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
    // Late: "already has Ward (6+)" looks at every other source (printed, aura, effect), and
    // this ability's own 6+ is not among them (I102).
    lateAuraGrants: (source, unit, scenario, _state, current) => {
      if (
        !isFriend(scenario, source, unit) ||
        !hasKeyword(scenario, unit, 'SERAPHON') ||
        !hasKeyword(scenario, unit, 'INFANTRY') ||
        !unitWhollyWithin(scenario, source, unit, 12)
      ) {
        return {};
      }
      return { ward: current.ward === 6 ? 5 : 6 };
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

/**
 * The activated abilities of M4h. Their options and resolution are in `../seraphonActive.ts`;
 * what lasts is here: Scry the Stars' ward, Armour Cruncher's -1 to saves and Star-venom's -1 to
 * wound rolls. Celestial Conduit's bonus is read by objective control (`conduit.ts`).
 */
export const SERAPHON_ACTIVATED: AbilityDefinition[] = [
  { id: VENOMITE_SWARM_ID, name: 'Venomite Swarm', kind: 'activated', bsdata: true },
  { id: CELESTIAL_CONDUIT_ID, name: 'Celestial Conduit', kind: 'activated', bsdata: true },
  {
    id: SCRY_THE_STARS_ID,
    name: 'Scry the Stars',
    kind: 'activated',
    bsdata: true,
    effectGrants: () => ({ ward: 5 }),
  },
  { id: COATL_FAMILIAR_ID, name: 'Coatl Familiar', kind: 'activated', bsdata: true },
  { id: ARK_OF_SOTEK_ID, name: 'Ark of Sotek', kind: 'activated', bsdata: true },
  {
    id: ARMOUR_CRUNCHER_ID,
    name: 'Armour Cruncher',
    kind: 'activated',
    bsdata: true,
    effectModifiers: (eff, sit) =>
      eff.targetUnit === sit.target.id
        ? [{ stat: 'save', value: -1, source: 'Armour Cruncher' }]
        : [],
  },
  {
    id: STAR_VENOM_ID,
    name: 'Star-venom',
    kind: 'activated',
    bsdata: true,
    // "subtract 1 from wound rolls for the target's combat attacks"
    effectModifiers: (eff, sit) =>
      eff.targetUnit === sit.attacker.id && sit.mode === 'fight'
        ? [{ stat: 'wound', value: -1, source: 'Star-venom' }]
        : [],
  },
];

/**
 * Records that the Hunters' Dartpipe allocated damage to `target`, for Star-venom (any damage
 * points from the attacks made with it this turn). Mutates `state`.
 */
export function recordDartpipeDamage(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  weapon: Weapon,
  target: UnitState,
): void {
  if (weapon.name !== 'Dartpipe') return;
  if (!abilitiesOf(scenario, attacker).some((a) => a.id === STAR_VENOM_ID)) return;
  if (
    (state.effects ?? []).some(
      (e) =>
        e.id === DARTPIPE_DAMAGE_ID && e.sourceUnit === attacker.id && e.targetUnit === target.id,
    )
  ) {
    return;
  }
  addEffect(state, {
    id: DARTPIPE_DAMAGE_ID,
    name: 'Dartpipe damage',
    sourceUnit: attacker.id,
    targetUnit: target.id,
    owner: attacker.owner,
    expires: 'turn',
  });
}

/** Realmshaper Engine (faction terrain, M4m): Fierce Guardians and Power Unleashed. */
export const SERAPHON_TERRAIN: AbilityDefinition[] = [
  {
    id: FIERCE_GUARDIANS_ID,
    name: 'Fierce Guardians',
    kind: 'passive',
    bsdata: true,
    terrainModifiers: (terrain, sit, scenario) =>
      sit.mode === 'fight'
        ? fierceGuardiansModifiers(terrain, sit.attacker, sit.target, scenario)
        : [],
  },
  { id: POWER_UNLEASHED_ID, name: 'Power Unleashed', kind: 'activated', bsdata: true },
];

for (const def of SERAPHON_PASSIVES) registerAbility(def);
for (const def of SERAPHON_ACTIVATED) registerAbility(def);
for (const def of SERAPHON_TERRAIN) registerAbility(def);
