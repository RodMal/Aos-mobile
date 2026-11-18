import {
  commandBlocker as baseCommandBlocker,
  payCommand as basePayCommand,
} from '../rules/core/commands.js';
import { strikeOrder, unitGrants } from './abilities/effects.js';
import { hasMagicOption } from './abilities/magic.js';
import { weaponTargets } from './combat.js';
import {
  CHARGE_END_RANGE,
  DIST_EPS,
  enemiesInCombat,
  enemiesWithin,
  inCombat,
  isFactionTerrainUnit,
  nearEnemyFactionTerrain,
  opponent,
  profileOf,
  unitDistance,
  unitsOf,
} from './query.js';
import { creepingDreadSurcharge, dwindling } from '../rules/factions/seasons.js';
import {
  type Allocation,
  type CommandId,
  type FightTier,
  type GameState,
  type PlayerId,
  type Scenario,
  type UnitId,
  type UnitOption,
  type UnitState,
} from './types.js';

/** Command points each player receives at the start of a battle round (before the underdog). */
export const CP_PER_ROUND = 4;
/** The longest charge roll, plus the 1/2" a charge may end from its target. */
export const MAX_CHARGE_REACH = 12 + CHARGE_END_RANGE;

/** Why `unit` cannot use `command` now (Creeping Dread may add 1 CP), or null. */
export function commandBlocker(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  command: CommandId,
  unit: UnitState,
): string | null {
  return baseCommandBlocker(
    state,
    player,
    command,
    unit,
    creepingDreadSurcharge(scenario, state, unit),
  );
}

/** Pays for a command, with Creeping Dread's extra point on the first command for a target. */
export function payCommand(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  command: CommandId,
  unit: UnitState,
): void {
  const extra = creepingDreadSurcharge(scenario, state, unit);
  basePayCommand(state, player, command, unit, extra);
  const dread = state.creepingDread;
  if (dread && dread.targets.includes(unit.id) && !dread.spent.includes(unit.id)) {
    state.creepingDread = { ...dread, spent: [...dread.spent, unit.id] };
  }
}

// ─── Eligibility ────────────────────────────────────────────────────────────────

export function moveOptions(scenario: Scenario, state: GameState, unit: UnitState): UnitOption[] {
  if (unit.moved !== null || unit.setUpThisTurn || isFactionTerrainUnit(scenario, unit)) return [];
  const profile = profileOf(scenario, unit);
  if (profile.move <= 0 && !profile.moveDice) return [];
  if (inCombat(scenario, state, unit)) {
    if (unit.isManifestation) return [];
    return [{ t: 'move', kind: 'retreat', allowance: profile.move }];
  }
  const grants = unitGrants(scenario, state, unit);
  const out: UnitOption[] = [{ t: 'move', kind: 'normal', allowance: profile.move }];
  if (!grants.cannotRun && !unit.isManifestation) {
    out.push({ t: 'move', kind: 'run', allowance: profile.move });
  }
  return out;
}

export function rawEligibleFighters(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  return unitsOf(state, player).filter((u) => {
    if (u.fought || isFactionTerrainUnit(scenario, u)) return false;
    // In combat is computed at most once per unit (it is the expensive part).
    let engaged: boolean | undefined;
    const isEngaged = (): boolean => (engaged ??= inCombat(scenario, state, u));
    // A unit that declined to attack faction terrain can still fight if an enemy unit comes
    // within combat range (it is not marked as having fought).
    if (u.declinedTerrainFight && !u.charged && !isEngaged()) return false;
    const melee = profileOf(scenario, u).weapons.some((w) => w.kind === 'melee');
    if (u.isManifestation && !melee) return false;
    if (u.charged || isEngaged()) return true;
    // optionalFighter, given that the unit neither charged nor is in combat.
    return melee && nearEnemyFactionTerrain(scenario, state, u);
  });
}

/** `rawEligibleFighters` for both players, computed once per question. */
export function bothRawFighters(scenario: Scenario, state: GameState): [UnitState[], UnitState[]] {
  return [rawEligibleFighters(scenario, state, 0), rawEligibleFighters(scenario, state, 1)];
}

/**
 * A unit that may fight only because it is within 3" of enemy faction terrain: it is not
 * obliged to (owner's ruling, 2026-11-11), so the picker may pass for it.
 */
export function optionalFighter(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (unit.charged || inCombat(scenario, state, unit)) return false;
  return (
    profileOf(scenario, unit).weapons.some((w) => w.kind === 'melee') &&
    nearEnemyFactionTerrain(scenario, state, unit)
  );
}

export function currentFightTier(scenario: Scenario, state: GameState): FightTier | null {
  return fightTierOf(scenario, state, bothRawFighters(scenario, state));
}

export function fightTierOf(
  scenario: Scenario,
  state: GameState,
  fighters: readonly [UnitState[], UnitState[]],
): FightTier | null {
  const all = [...fighters[0], ...fighters[1]];
  if (all.length === 0) return null;
  const tiers = new Set(all.map((u) => strikeOrder(scenario, state, u)));
  if (tiers.has('strikeFirst')) return 'strikeFirst';
  if (tiers.has('normal')) return 'normal';
  if (tiers.has('strikeLast')) return 'strikeLast';
  return null;
}

/**
 * Units of `player` that may be picked to fight in the current strike-order tier:
 * STRIKE-FIRST units first, then normal, then STRIKE-LAST.
 */
export function eligibleFighters(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  return eligibleFrom(scenario, state, bothRawFighters(scenario, state), player);
}

export function eligibleFrom(
  scenario: Scenario,
  state: GameState,
  fighters: readonly [UnitState[], UnitState[]],
  player: PlayerId,
  tier = fightTierOf(scenario, state, fighters),
): UnitState[] {
  if (!tier) return [];
  return fighters[player].filter((u) => strikeOrder(scenario, state, u) === tier);
}

export function canCharge(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (unit.chargeDeclared) return false;
  if (unit.moved === 'retreat' && !dwindling(scenario, state, unit)) return false;
  if (isFactionTerrainUnit(scenario, unit)) return false;
  if (unit.isManifestation && !profileOf(scenario, unit).weapons.some((w) => w.kind === 'melee')) {
    return false;
  }
  const grants = unitGrants(scenario, state, unit);
  if (unit.moved === 'run' && !grants.runAndCharge) return false;
  if (inCombat(scenario, state, unit)) return false;
  return enemiesWithin(scenario, state, unit, MAX_CHARGE_REACH).length > 0;
}

export function canRally(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(scenario, state, unit.owner, 'rally', unit)) return false;
  if (isFactionTerrainUnit(scenario, unit)) return false;
  if (inCombat(scenario, state, unit)) return false;
  return unit.damage > 0 || unit.models.some((m) => !m.alive);
}

export function canRedeploy(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(scenario, state, unit.owner, 'redeploy', unit)) return false;
  if (inCombat(scenario, state, unit) || unit.moved !== null) return false;
  if (isFactionTerrainUnit(scenario, unit)) return false;
  return profileOf(scenario, unit).move > 0;
}

export function canCounterCharge(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(scenario, state, unit.owner, 'counterCharge', unit)) return false;
  return canCharge(scenario, state, unit);
}

export function coveringFireAllocations(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): Allocation[] {
  if (commandBlocker(scenario, state, unit.owner, 'coveringFire', unit)) return [];
  if (isFactionTerrainUnit(scenario, unit)) return [];
  // "A friendly unit that has not run and is not in combat" (shooting phase only, owner's
  // ruling 2026-11-11; the offer is made only at the end of the enemy shooting phase).
  if (state.phase !== 'shooting') return [];
  if (inCombat(scenario, state, unit)) return [];
  if (unit.moved === 'run' && !unitGrants(scenario, state, unit).runAndShoot) return [];
  const wts = weaponTargets(scenario, state, unit, 'shoot');
  if (wts.length === 0) return [];
  const allEnemies = unitsOf(state, opponent(unit.owner));
  if (allEnemies.length === 0) return [];
  let minDist = Infinity;
  for (const e of allEnemies) {
    const d = unitDistance(scenario, unit, e);
    if (d < minDist) minDist = d;
  }
  const closestIds = new Set(
    allEnemies
      .filter((e) => unitDistance(scenario, unit, e) <= minDist + DIST_EPS + 0.05)
      .map((e) => e.id),
  );
  const allocations: Allocation[] = [];
  for (const wt of wts) {
    const legalClosest = wt.targets
      .filter((t) => closestIds.has(t.unit))
      .sort((a, b) => b.expectedDamage - a.expectedDamage);
    if (legalClosest.length > 0) {
      allocations.push({ weaponId: wt.weaponId, target: legalClosest[0]!.unit });
    }
  }
  return allocations;
}

export function canMagicalIntervention(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): boolean {
  if (commandBlocker(scenario, state, unit.owner, 'magicalIntervention', unit)) return false;
  const probe: GameState = {
    ...state,
    stack: [...state.stack, { t: 'magicalIntervention', unit: unit.id }],
  };
  return hasMagicOption(scenario, probe, unit);
}

export function powerThroughTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitId[] {
  if (!unit.charged || commandBlocker(scenario, state, unit.owner, 'powerThrough', unit)) return [];
  const myHealth = profileOf(scenario, unit).health;
  const engaged = enemiesInCombat(scenario, state, unit);
  if (engaged.length === 0) return [];
  return engaged.filter((e) => profileOf(scenario, e).health < myHealth).map((e) => e.id);
}

// ─── Engine ─────────────────────────────────────────────────────────────────────
