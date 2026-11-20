/**
 * Sylvaneth set-up and charge abilities (task M4g): Huntmaster's Strike, Rhythm of the Chase,
 * Merciless Ambush, Shadowcreep, Realmroot Guide and Guardian Of The Glades. This module holds
 * who may use each and the limits on where a unit is set up again; `relocating.ts` does the
 * actions. Printed text is in data/factions/sylvaneth.json; readings in docs/RULES-DECISIONS.md.
 */
import { footprintGapAtLeast } from '../geom/index.js';
import { abilitiesOf, effectsOnUnit } from './abilities/effects.js';
import {
  GUARDIAN_OF_THE_GLADES_ID,
  HUNTMASTERS_STRIKE_ID,
  MERCILESS_AMBUSH_ID,
  REALMROOT_GUIDE_ID,
  RHYTHM_OF_THE_CHASE_ID,
  SHADOWCREEP_ID,
} from './abilities/sylvaneth.js';
import { MAX_CHARGE_REACH, canCharge, commandBlocker } from './eligibility.js';
import {
  inCreepingOvergrowth,
  modelsOutsideOvergrowth,
  overgrownTokenIds,
  terrainFeatures,
  whollyWithinFeature,
} from './overgrowth.js';
import {
  CHARGE_END_RANGE,
  COMBAT_RANGE,
  DIST_EPS,
  enemiesInCombat,
  enemiesWithin,
  footprintsWithin,
  hasKeyword,
  inCombat,
  isFactionTerrainUnit,
  modelFootprint,
  opponent,
  unitFootprints,
  unitsOf,
  unitsWithin,
} from './query.js';
import type {
  GameState,
  Placement,
  Relocation,
  Scenario,
  UnitId,
  UnitOption,
  UnitState,
  Violation,
} from './types.js';

/** Abilities that start with a `main` `ability` action (the others are a reaction, a command, a pick). */
export const SET_UP_ABILITY_IDS: readonly string[] = [
  SHADOWCREEP_ID,
  REALMROOT_GUIDE_ID,
  GUARDIAN_OF_THE_GLADES_ID,
];

/** Shadowcreep: "wholly within 3\" of a terrain feature". */
export const SHADOWCREEP_RANGE = 3;
/** Huntmaster's Strike: "more than 6\" from all enemy units". */
export const HUNTMASTER_GAP = 6;
/** Shadowcreep and Realmroot Guide: "more than 9\" from all enemy units". */
export const OVERGROWTH_SET_UP_GAP = 9;
/** Chameleon Ambush: "more than 9\" from all enemy units". */
export const CHAMELEON_GAP = 9;
/** Rhythm of the Chase: "within 1\" of the target". */
export const RHYTHM_RANGE = 1;

export function hasSylvanethAbility(scenario: Scenario, unit: UnitState, id: string): boolean {
  return abilitiesOf(scenario, unit).some((a) => a.id === id);
}

const usable = (scenario: Scenario, unit: UnitState): boolean =>
  unit.status === 'battlefield' && !isFactionTerrainUnit(scenario, unit) && !unit.isManifestation;

export function usedThisTurn(state: GameState, unit: UnitState, id: string): boolean {
  return (state.players[unit.owner].usedOncePerTurn ?? []).includes(id);
}

/** The key under which a once-per-battle ability is recorded for a unit. */
export const battleKey = (unit: UnitState, id: string): string => `${unit.id}:${id}`;

export function usedThisBattle(state: GameState, unit: UnitState, id: string): boolean {
  return (state.players[unit.owner].usedOncePerBattle ?? []).includes(battleKey(unit, id));
}

/** Huntmaster's Strike: "If this unit charged this turn", at the end of any turn. */
export function canHuntmaster(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return (
    usable(scenario, unit) &&
    unit.charged &&
    hasSylvanethAbility(scenario, unit, HUNTMASTERS_STRIKE_ID) &&
    !usedThisTurn(state, unit, HUNTMASTERS_STRIKE_ID)
  );
}

/** Rhythm of the Chase: enemy units in combat with `unit`, in a combat phase before any unit has fought; empty if unusable. */
export function rhythmTargets(scenario: Scenario, state: GameState, unit: UnitState): UnitId[] {
  if (state.phase !== 'combat' || !usable(scenario, unit)) return [];
  if (!hasSylvanethAbility(scenario, unit, RHYTHM_OF_THE_CHASE_ID)) return [];
  if (usedThisTurn(state, unit, RHYTHM_OF_THE_CHASE_ID)) return [];
  return enemiesInCombat(scenario, state, unit).map((e) => e.id);
}

/** Shadowcreep: "wholly within the creeping overgrowth", in your movement phase. */
export function canShadowcreep(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return (
    state.phase === 'movement' &&
    state.active === unit.owner &&
    usable(scenario, unit) &&
    hasSylvanethAbility(scenario, unit, SHADOWCREEP_ID) &&
    !usedThisTurn(state, unit, SHADOWCREEP_ID) &&
    inCreepingOvergrowth(scenario, state, unit, unit.owner, true)
  );
}

/**
 * Realmroot Guide: usable once per battle in your movement phase by a unit that is wholly
 * within the creeping overgrowth. Returns the other units that may go with it (friendly
 * Sylvaneth units within this unit's combat range), or null when it cannot be used.
 */
export function realmrootCompanions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitId[] | null {
  if (state.phase !== 'movement' || state.active !== unit.owner || !usable(scenario, unit)) {
    return null;
  }
  if (!hasSylvanethAbility(scenario, unit, REALMROOT_GUIDE_ID)) return null;
  if (usedThisBattle(state, unit, REALMROOT_GUIDE_ID)) return null;
  if (!inCreepingOvergrowth(scenario, state, unit, unit.owner, true)) return null;
  return unitsOf(state, unit.owner)
    .filter(
      (o) =>
        o.id !== unit.id &&
        usable(scenario, o) &&
        hasKeyword(scenario, o, 'SYLVANETH') &&
        unitsWithin(scenario, unit, o, COMBAT_RANGE),
    )
    .map((o) => o.id);
}

/**
 * Guardian Of The Glades: the enemy units in combat with another friendly Sylvaneth Hero.
 * The charge must end within 1/2" of one of them.
 */
export function guardianTargets(scenario: Scenario, state: GameState, unit: UnitState): UnitId[] {
  const out = new Set<UnitId>();
  for (const hero of unitsOf(state, unit.owner)) {
    if (hero.id === unit.id || !usable(scenario, hero)) continue;
    if (!hasKeyword(scenario, hero, 'SYLVANETH') || !hasKeyword(scenario, hero, 'HERO')) continue;
    for (const e of enemiesInCombat(scenario, state, hero)) out.add(e.id);
  }
  return [...out];
}

/** Whether Guardian Of The Glades may be declared now (before the charge roll). */
export function canGuardian(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (state.phase !== 'charge' || state.active !== unit.owner || !usable(scenario, unit)) {
    return false;
  }
  if (!hasSylvanethAbility(scenario, unit, GUARDIAN_OF_THE_GLADES_ID)) return false;
  if (usedThisTurn(state, unit, GUARDIAN_OF_THE_GLADES_ID)) return false;
  if (!canCharge(scenario, state, unit)) return false;
  const wanted = guardianTargets(scenario, state, unit);
  return enemiesWithin(scenario, state, unit, MAX_CHARGE_REACH + 2).some((e) =>
    wanted.includes(e.id),
  );
}

/**
 * While Guardian Of The Glades is on the unit, the only enemy units its charge may reach;
 * null when the unit has no such restriction.
 */
export function chargeRestriction(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitId[] | null {
  if (!effectsOnUnit(state, unit.id).some((e) => e.id === GUARDIAN_OF_THE_GLADES_ID)) return null;
  return guardianTargets(scenario, state, unit);
}

/** Merciless Ambush: "not in combat and has not used a Run or Retreat ability this turn". */
export function canMercilessAmbush(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(scenario, state, unit.owner, 'mercilessAmbush', unit)) return false;
  if (!usable(scenario, unit) || !hasSylvanethAbility(scenario, unit, MERCILESS_AMBUSH_ID)) {
    return false;
  }
  if (unit.chargeDeclared || unit.charged) return false;
  if (unit.moved === 'run' || unit.moved === 'retreat') return false;
  if (inCombat(scenario, state, unit)) return false;
  if (overgrownTokenIds(scenario, state, unit.owner).length === 0) return false;
  return unitsOf(state, opponent(unit.owner)).some((e) => !isFactionTerrainUnit(scenario, e));
}

/** The activated abilities `unit` has in the movement phase. */
export function movementSetUpOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  const out: UnitOption[] = [];
  if (canShadowcreep(scenario, state, unit)) {
    out.push({
      t: 'ability',
      abilityId: SHADOWCREEP_ID,
      name: 'Shadowcreep',
      kind: 'activated',
      targets: [],
    });
  }
  const companions = realmrootCompanions(scenario, state, unit);
  if (companions) {
    out.push({
      t: 'ability',
      abilityId: REALMROOT_GUIDE_ID,
      name: 'Realmroot Guide',
      kind: 'activated',
      targets: [],
    });
    if (companions.length > 0) {
      out.push({
        t: 'ability',
        abilityId: REALMROOT_GUIDE_ID,
        name: 'Realmroot Guide with another unit',
        kind: 'activated',
        targets: companions,
      });
    }
  }
  return out;
}

/** The activated abilities and commands `unit` has in the charge phase. */
export function chargeSetUpOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  const out: UnitOption[] = [];
  if (canGuardian(scenario, state, unit)) {
    out.push({
      t: 'ability',
      abilityId: GUARDIAN_OF_THE_GLADES_ID,
      name: 'Guardian Of The Glades',
      kind: 'activated',
      targets: [],
    });
  }
  if (canMercilessAmbush(scenario, state, unit)) {
    out.push({ t: 'command', command: 'mercilessAmbush', cost: 1 });
  }
  return out;
}

// ─── Where a unit may be set up again ───────────────────────────────────────────

/**
 * Violations of the printed limits of the ability that is setting `unit` up again, on top of the
 * general ones (`checkMovePlacement` with the ability's gap from enemy units).
 */
export function relocateViolations(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  placement: Placement,
  relocate: Relocation,
): Violation[] {
  const list = placement.models.map((m) => ({
    i: m.i,
    fp: modelFootprint(scenario, unit, m.i, m),
  }));
  const fps = list.map((m) => m.fp);
  const out: Violation[] = [];
  const all = (): number[] => list.map((m) => m.i);
  switch (relocate.kind) {
    case 'huntmaster':
    case 'realmroot': {
      const outside = modelsOutsideOvergrowth(scenario, state, unit.owner, list);
      if (outside.length > 0) {
        out.push({
          code: 'OUTSIDE_TERRITORY',
          message: 'Must be set up wholly within your creeping overgrowth.',
          models: outside,
        });
      }
      break;
    }
    case 'shadowcreep':
      if (
        !terrainFeatures(scenario, state).some((f) =>
          whollyWithinFeature(scenario, f, fps, SHADOWCREEP_RANGE),
        )
      ) {
        out.push({
          code: 'TOO_FAR',
          message: 'Must be set up wholly within 3" of a terrain feature.',
          models: all(),
        });
      }
      break;
    case 'ambush': {
      const reach = relocate.reach ?? 0;
      const tokens = overgrownTokenIds(scenario, state, unit.owner);
      if (
        !terrainFeatures(scenario, state).some(
          (f) => tokens.includes(f.id) && whollyWithinFeature(scenario, f, fps, reach),
        )
      ) {
        out.push({
          code: 'TOO_FAR',
          message: `Must be set up wholly within ${reach}" of a terrain feature that has your overgrown token.`,
          models: all(),
        });
      }
      const enemies = unitsOf(state, opponent(unit.owner))
        .filter((e) => !isFactionTerrainUnit(scenario, e))
        .flatMap((e) => unitFootprints(scenario, e));
      const reaches = fps.some((fp) =>
        enemies.some((e) => !footprintGapAtLeast(fp, e, CHARGE_END_RANGE + DIST_EPS)),
      );
      if (!reaches) {
        out.push({
          code: 'NOT_IN_CHARGE_RANGE',
          message: 'Must be set up within ½" of an enemy unit.',
        });
      }
      break;
    }
    case 'rhythm': {
      const target = relocate.target ? state.units[relocate.target] : undefined;
      const targetFps =
        target && target.status === 'battlefield' ? unitFootprints(scenario, target) : [];
      if (!footprintsWithin(fps, targetFps, RHYTHM_RANGE)) {
        out.push({
          code: 'TOO_FAR',
          message: `Must be set up within 1" of ${target?.name ?? 'the target'}.`,
          models: all(),
        });
      }
      break;
    }
  }
  return out;
}

/** The gap from enemy units a set-up of this kind needs ("more than X\""). */
export function relocateGap(kind: Relocation['kind']): number {
  switch (kind) {
    case 'huntmaster':
      return HUNTMASTER_GAP;
    case 'shadowcreep':
    case 'realmroot':
      return OVERGROWTH_SET_UP_GAP;
    case 'chameleon':
      return CHAMELEON_GAP;
    default:
      return 0;
  }
}
