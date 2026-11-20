/**
 * Sylvaneth passive abilities (task M4d): the wards of Alarielle's Song, Terror Of The Deep
 * Woods, One With The Forest, Kurnothi War-horn, the three Battle Damaged abilities and the
 * Glamourweave artefact. Hand-written and keyed by BSData id.
 */
import type { Dice, Weapon } from '../../data/profile.js';
import { VENGEFUL_FOREST_SPIRITS_ID } from '../factionTerrainActive.js';
import { inCreepingOvergrowth } from '../overgrowth.js';
import { hasKeyword, profileOf, unitWhollyWithin, unitsWithin } from '../query.js';
import type { GameState, Scenario, UnitState } from '../types.js';
import { addEffect, effectsOnUnit, registerAbility } from './effects.js';
import type { AbilityDefinition } from './types.js';

export const ALARIELLES_SONG_ID = '3f73-3ee4-8f6b-b16b';
export const TERROR_OF_THE_DEEP_WOODS_ID = 'a1f-39fd-6570-f3d5';
export const ONE_WITH_THE_FOREST_ID = 'f62f-75b0-48cd-101e';
export const KURNOTHI_WAR_HORN_ID = '59e8-f376-a5df-144c';
export const GLAMOURWEAVE_ID = 'cafd-9cf1-871c-f47e';
/** The `ability` action that answers "re-roll this failed roll" (a `pass` keeps it). */
export const GLAMOURWEAVE_REROLL_ID = 'glamourweave';

/** Set-up and charge abilities (task M4g); the behaviour is in `relocate.ts`. */
export const HUNTMASTERS_STRIKE_ID = '61d2-55e1-7873-e100';
export const RHYTHM_OF_THE_CHASE_ID = 'b29c-dd1a-502d-27c4';
export const MERCILESS_AMBUSH_ID = '77b2-7e2-ba0c-83a1';
export const SHADOWCREEP_ID = '76b2-ce61-8aec-f6c1';
export const REALMROOT_GUIDE_ID = 'c133-8f0c-936d-30d3';
export const GUARDIAN_OF_THE_GLADES_ID = 'ea9f-5c5b-8b97-78aa';

/** Activated abilities of task M4i; who may use them is in `../sylvanethActive.ts`. */
export const LIFEBLOOM_ID = 'e4b4-8e4d-5f0-eb6a';
export const LIVING_BATTERING_RAM_ID = '5abd-6507-dbee-ed76';
export const GROUNDSHAKER_ID = '7124-769a-aafd-7b38';
export const WYLDWOOD_REVENANTS_ID = 'dc61-1f39-51f9-52da';
export const ASPECT_OF_HEARTWOOD_ID = '0770-09a1-99c6-1a99';

const BATTLE_DAMAGED_FROM = 10;

function battleDamaged(id: string, weaponName: string, attacks: number): AbilityDefinition {
  return {
    id,
    name: 'Battle Damaged',
    kind: 'passive',
    bsdata: true,
    weaponFor: (unit: UnitState, weapon: Weapon): Weapon => {
      if (unit.damage < BATTLE_DAMAGED_FROM || weapon.name.trim() !== weaponName) return weapon;
      const dice: Dice = { n: 0, sides: 0, plus: attacks };
      return { ...weapon, attacks: dice };
    },
  };
}

const isFriendlySylvaneth = (scenario: Scenario, source: UnitState, unit: UnitState): boolean =>
  unit.owner === source.owner &&
  hasKeyword(scenario, unit, 'SYLVANETH') &&
  !profileOf(scenario, unit).isFactionTerrain;

export const SYLVANETH_PASSIVES: AbilityDefinition[] = [
  {
    id: ALARIELLES_SONG_ID,
    name: "Alarielle's Song",
    kind: 'passive',
    bsdata: true,
    auraGrants: (source, unit, scenario) => {
      if (profileOf(scenario, unit).isFactionTerrain) return {};
      if (unit.owner === source.owner) {
        return isFriendlySylvaneth(scenario, source, unit) &&
          unitWhollyWithin(scenario, source, unit, 12)
          ? { ward: 6 }
          : {};
      }
      return unitsWithin(scenario, source, unit, 12) ? { wardRollModifier: -1 } : {};
    },
  },
  {
    id: TERROR_OF_THE_DEEP_WOODS_ID,
    name: 'Terror Of The Deep Woods',
    kind: 'passive',
    bsdata: true,
    auraGrants: (source, unit, scenario) =>
      unit.owner !== source.owner &&
      !profileOf(scenario, unit).isFactionTerrain &&
      unitsWithin(scenario, source, unit, 9)
        ? { cannotRun: true, cannotRetreat: true }
        : {},
  },
  {
    id: ONE_WITH_THE_FOREST_ID,
    name: 'One With The Forest',
    kind: 'passive',
    bsdata: true,
    defenceModifiers: (self, _sit, scenario, state) =>
      inCreepingOvergrowth(scenario, state, self, self.owner, true)
        ? [
            { stat: 'hit', value: -1, source: 'One With The Forest' },
            { stat: 'wound', value: -1, source: 'One With The Forest' },
          ]
        : [],
  },
  {
    id: KURNOTHI_WAR_HORN_ID,
    name: 'Kurnothi War-horn',
    kind: 'passive',
    bsdata: true,
    // The source is a friendly Kurnothi unit wholly within 12" of itself, so it gets the bonus too.
    auraGrants: (source, unit, scenario) =>
      unit.owner === source.owner &&
      hasKeyword(scenario, unit, 'KURNOTHI') &&
      unitWhollyWithin(scenario, source, unit, 12)
        ? { moveBonus: 2 }
        : {},
  },
  battleDamaged('135b-afc5-4fd9-3460', "Wardroth Beetle's Antlers", 4),
  battleDamaged('c6b8-a8fd-b2-59fa', "Carnelian Greatspite's Mandibles", 3),
  battleDamaged('2eb1-9bd5-1544-36d9', 'Guardian Sword', 3),
  { id: HUNTMASTERS_STRIKE_ID, name: "Huntmaster's Strike", kind: 'activated', bsdata: true },
  { id: RHYTHM_OF_THE_CHASE_ID, name: 'Rhythm of the Chase', kind: 'activated', bsdata: true },
  { id: MERCILESS_AMBUSH_ID, name: 'Merciless Ambush', kind: 'command', bsdata: true },
  {
    // "Then add 1 to charge rolls for this unit for the rest of the turn."
    id: SHADOWCREEP_ID,
    name: 'Shadowcreep',
    kind: 'activated',
    bsdata: true,
    effectGrants: () => ({ chargeRollModifier: 1 }),
  },
  { id: REALMROOT_GUIDE_ID, name: 'Realmroot Guide', kind: 'activated', bsdata: true },
  {
    // "Add 2 to the charge roll": the effect lasts for the unit's charge this turn.
    id: GUARDIAN_OF_THE_GLADES_ID,
    name: 'Guardian Of The Glades',
    kind: 'activated',
    bsdata: true,
    effectGrants: () => ({ chargeRollModifier: 2 }),
  },
  { id: LIFEBLOOM_ID, name: 'Lifebloom', kind: 'activated', bsdata: true },
  { id: LIVING_BATTERING_RAM_ID, name: 'Living Battering Ram', kind: 'activated', bsdata: true },
  {
    // "the target has Strike-last for the rest of the turn"
    id: GROUNDSHAKER_ID,
    name: 'Groundshaker',
    kind: 'activated',
    bsdata: true,
    effectGrants: () => ({ keywords: ['STRIKE-LAST'] }),
  },
  {
    id: VENGEFUL_FOREST_SPIRITS_ID,
    name: 'Vengeful Forest Spirits',
    kind: 'activated',
    bsdata: true,
  },
  { id: WYLDWOOD_REVENANTS_ID, name: 'Wyldwood Revenants', kind: 'activated', bsdata: true },
  { id: ASPECT_OF_HEARTWOOD_ID, name: 'Aspect of Heartwood', kind: 'activated', bsdata: true },
  // The re-rolls are applied by `glamourRerolls` / `spendGlamourweave` (combat.ts).
  { id: GLAMOURWEAVE_ID, name: 'Glamourweave', kind: 'passive', bsdata: true },
];

for (const def of SYLVANETH_PASSIVES) registerAbility(def);

// ─── Glamourweave ───────────────────────────────────────────────────────────────

type RerollKind = 'hit' | 'wound' | 'save';

/** True when `unit` carries the Glamourweave artefact. */
export function hasGlamourweave(scenario: Scenario, unit: UnitState): boolean {
  const army = scenario.armies[unit.owner].units[unit.armyIndex];
  if (unit.enhancementsLost) return false;
  return army?.enhancements.some((e) => e.ability.id === GLAMOURWEAVE_ID) ?? false;
}

function rerollSpent(state: GameState, unit: UnitState, kind: RerollKind): boolean {
  return effectsOnUnit(state, unit.id).some((e) => e.id === `${GLAMOURWEAVE_ID}:${kind}`);
}

/**
 * The Glamourweave re-rolls still free for an attack: hit and wound for the attacker's own
 * rolls, save for the target's save rolls (each once per phase).
 */
export function glamourRerolls(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  target: UnitState,
): { hit?: boolean; wound?: boolean; save?: boolean } {
  const out: { hit?: boolean; wound?: boolean; save?: boolean } = {};
  if (hasGlamourweave(scenario, attacker)) {
    if (!rerollSpent(state, attacker, 'hit')) out.hit = true;
    if (!rerollSpent(state, attacker, 'wound')) out.wound = true;
  }
  if (hasGlamourweave(scenario, target) && !rerollSpent(state, target, 'save')) out.save = true;
  return out;
}

/** Records the re-rolls an attack used, so each is spent for the rest of the phase. */
export function spendGlamourweave(
  state: GameState,
  attacker: UnitState,
  target: UnitState,
  rerolled: { hit: boolean; wound: boolean; save: boolean },
): void {
  const spend = (unit: UnitState, kind: RerollKind): void =>
    addEffect(state, {
      id: `${GLAMOURWEAVE_ID}:${kind}`,
      name: `Glamourweave (${kind} re-roll used)`,
      sourceUnit: unit.id,
      targetUnit: unit.id,
      owner: unit.owner,
      expires: 'phase',
    });
  if (rerolled.hit) spend(attacker, 'hit');
  if (rerolled.wound) spend(attacker, 'wound');
  if (rerolled.save) spend(target, 'save');
}
