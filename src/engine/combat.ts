/**
 * Shooting and fighting: which weapons can attack which targets, and resolving the attacks
 * of one unit. Range is measured base edge to base edge from each model, and only models in
 * range of the chosen target attack. Line of sight comes in M3.
 */
import { attackModifiers, sumModifiers } from '../rules/core/modifiers.js';
import { clearExpiredEffects, effectiveWard, unitGrants } from './abilities/effects.js';
import { hasAbility, rollAttackCount, rollAttackSequence, rollWard } from './attack.js';
import { illegal, type Ctx } from './ctx.js';
import { allocateDamage } from './damage.js';
import { expectedAttacks, expectedDamage, type AttackMods } from './expected.js';
import {
  COMBAT_RANGE,
  enemiesWithin,
  inCombat,
  modelsWithinRangeOf,
  profileOf,
  unitBounds,
  unitsOf,
  opponent,
} from './query.js';
import { effectiveWeaponRange, isGuardedHero, isUnitVisible } from './terrain.js';
import type { Weapon } from '../data/profile.js';
import type {
  Allocation,
  AttackMode,
  Frame,
  GameState,
  Scenario,
  UnitState,
  WeaponTargets,
} from './types.js';

/** True when the unit may shoot this turn at all (weapons and targets aside). */
export function mayShoot(unit: UnitState, runAndShoot = false): boolean {
  return (
    unit.status === 'battlefield' &&
    !unit.shot &&
    (unit.moved !== 'run' || runAndShoot) &&
    unit.moved !== 'retreat'
  );
}

/**
 * Model indices that carry `weapon`, or null when every model does. An army list entry can
 * say how many models carry each weapon where the warscroll offers a choice (`weapons`):
 * the named weapons go to the first models by index, in the order listed, and the other
 * weapons of the same kind go to the rest.
 */
export function weaponCarriers(
  scenario: Scenario,
  unit: UnitState,
  weapon: Weapon,
): Set<number> | null {
  if (unit.isManifestation) return null;
  const loadout = scenario.armies[unit.owner].list.units[unit.armyIndex]?.weapons;
  if (!loadout) return null;
  const profile = profileOf(scenario, unit);
  const named = profile.weapons.filter((w) => loadout[w.name] !== undefined);
  if (!named.some((w) => w.kind === weapon.kind)) return null;
  const carriers = new Map<string, Set<number>>();
  let next = 0;
  for (const w of named) {
    const set = new Set<number>();
    for (let k = 0; k < loadout[w.name]! && next < profile.models.length; k++) set.add(next++);
    carriers.set(w.id, set);
  }
  const own = carriers.get(weapon.id);
  if (own) return own;
  const rest = new Set<number>();
  for (let i = next; i < profile.models.length; i++) rest.add(i);
  return rest;
}

/** Living models of `attacker` that carry `weapon` and are within `range` of `target`. */
function attackingModels(
  scenario: Scenario,
  attacker: UnitState,
  target: UnitState,
  weapon: Weapon,
  range: number,
): number[] {
  const indices = modelsWithinRangeOf(scenario, attacker, target, range);
  const carriers = weaponCarriers(scenario, attacker, weapon);
  return carriers ? indices.filter((i) => carriers.has(i)) : indices;
}

function championsAmong(scenario: Scenario, unit: UnitState, indices: number[]): number {
  const models = profileOf(scenario, unit).models;
  return indices.filter((i) => models[i]!.champion).length;
}

/** Modifiers for one weapon attacking one target, capped. */
export function weaponMods(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  target: UnitState,
  weapon: Weapon,
  mode: AttackMode,
  extra: { allOutAttack?: boolean; allOutDefence?: boolean; coveringFire?: boolean } = {},
): AttackMods {
  const targetGrants = unitGrants(scenario, state, target);
  return sumModifiers(
    attackModifiers(scenario, state, { attacker, target, weapon, mode, ...extra }),
    weapon,
    { ignoreSaveModifiers: targetGrants.ignoreSaveModifiers },
  );
}

/** Expected damage of `indices` models of `attacker` using `weapon` on `target`. */
export function expectedWeaponDamage(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  target: UnitState,
  weapon: Weapon,
  mode: AttackMode,
  indices: number[],
  extra: { allOutAttack?: boolean; allOutDefence?: boolean; coveringFire?: boolean } = {},
): number {
  const tp = profileOf(scenario, target);
  const ward = effectiveWard(scenario, state, target) ?? null;
  const attacks = expectedAttacks(
    weapon,
    indices.length,
    championsAmong(scenario, attacker, indices),
  );
  const mods = weaponMods(scenario, state, attacker, target, weapon, mode, extra);
  return expectedDamage(weapon, attacks, { save: tp.save, ward }, mods).total;
}

/**
 * Weapons that can attack now and their legal targets. Shooting: ranged weapons (only
 * Shoot in Combat ones while the unit is in combat), for a unit that has not shot, run or
 * retreated. Fighting: melee weapons against enemy units within 3". Weapons without a
 * target are left out.
 */
export function weaponTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  mode: AttackMode,
): WeaponTargets[] {
  if (unit.status !== 'battlefield') return [];
  const profile = profileOf(scenario, unit);
  let weapons: Weapon[];
  let candidates: UnitState[];
  if (mode === 'shoot') {
    const grants = unitGrants(scenario, state, unit);
    if (!mayShoot(unit, grants.runAndShoot)) return [];
    const engaged = inCombat(scenario, state, unit);
    weapons = profile.weapons.filter(
      (w) => w.kind === 'ranged' && (!engaged || hasAbility(w, 'shootInCombat')),
    );
    if (weapons.length === 0) return [];
    const maxRange = Math.max(
      ...weapons.map((w) => effectiveWeaponRange(scenario, state, unit, w.range)),
    );
    const own = unitBounds(scenario, unit);
    candidates = unitsOf(state, opponent(unit.owner)).filter((e) => {
      // Faction terrain is a unit only in the combat phase (owner's ruling).
      if (profileOf(scenario, e).isFactionTerrain) return false;
      if (!isUnitVisible(scenario, state, unit, e)) return false;
      const b = unitBounds(scenario, e);
      return Math.hypot(b.x - own.x, b.y - own.y) - b.r - own.r <= maxRange + 1e-6;
    });
  } else {
    weapons = profile.weapons.filter((w) => w.kind === 'melee');
    if (weapons.length === 0) return [];
    // Units within 3" of enemy faction terrain may attack it.
    candidates = enemiesWithin(scenario, state, unit, COMBAT_RANGE, true);
  }
  const out: WeaponTargets[] = [];
  for (const weapon of weapons) {
    const range = mode === 'shoot' ? weapon.range : COMBAT_RANGE;
    const targets: WeaponTargets['targets'] = [];
    for (const target of candidates) {
      let allowedRange = range;
      if (mode === 'shoot') {
        allowedRange = effectiveWeaponRange(scenario, state, unit, weapon.range);
        if (isGuardedHero(scenario, state, target).infantry) {
          allowedRange = Math.min(allowedRange, 12);
        }
      }
      const indices = attackingModels(scenario, unit, target, weapon, allowedRange);
      if (indices.length === 0) continue;
      targets.push({
        unit: target.id,
        modelsInRange: indices.length,
        expectedDamage: expectedWeaponDamage(scenario, state, unit, target, weapon, mode, indices),
      });
    }
    if (targets.length > 0) out.push({ weaponId: weapon.id, weaponName: weapon.name, targets });
  }
  return out;
}

/** Throws unless every allocation names an offered weapon (once) and one of its targets. */
export function checkAllocations(options: WeaponTargets[], allocations: Allocation[]): void {
  const used = new Set<string>();
  for (const a of allocations) {
    const option = options.find((o) => o.weaponId === a.weaponId);
    if (!option) illegal('That weapon cannot attack now.');
    if (used.has(a.weaponId)) illegal('Each weapon attacks one target.');
    used.add(a.weaponId);
    if (!option.targets.some((t) => t.unit === a.target)) {
      illegal(`${option.weaponName} cannot reach that target.`);
    }
  }
}

/** Rolls every allocated weapon's attacks, then allocates the damage to each target. */
export function resolveAttacks(ctx: Ctx, frame: Extract<Frame, { t: 'resolve' }>): void {
  const { scenario, s } = ctx;
  const attacker = s.units[frame.unit]!;
  if (attacker.status !== 'battlefield') return;
  const profile = profileOf(scenario, attacker);
  const pending = new Map<string, number>();
  for (const alloc of frame.allocations) {
    const weapon = profile.weapons.find((w) => w.id === alloc.weaponId)!;
    const target = s.units[alloc.target]!;
    if (target.status !== 'battlefield') continue;
    let allowedRange = frame.mode === 'shoot' ? weapon.range : COMBAT_RANGE;
    if (frame.mode === 'shoot') {
      allowedRange = effectiveWeaponRange(scenario, s, attacker, weapon.range);
      if (isGuardedHero(scenario, s, target).infantry) {
        allowedRange = Math.min(allowedRange, 12);
      }
    }
    const indices = attackingModels(scenario, attacker, target, weapon, allowedRange);
    if (indices.length === 0) continue;
    const tp = profileOf(scenario, target);
    const targetWard = effectiveWard(scenario, s, target) ?? null;
    const attacks = rollAttackCount(
      ctx.rng,
      weapon,
      indices.length,
      championsAmong(scenario, attacker, indices),
    );
    const mods = weaponMods(scenario, s, attacker, target, weapon, frame.mode, {
      allOutAttack: frame.allOutAttack,
      allOutDefence: frame.defended.includes(target.id),
      coveringFire: frame.coveringFire,
    });
    const roll = rollAttackSequence(ctx.rng, {
      weapon,
      attacks,
      mods,
      target: { save: tp.save, ward: targetWard },
    });
    const ward = rollWard(ctx.rng, roll.damage + roll.mortal, targetWard);
    ctx.events.push({
      t: 'attacks',
      attacker: attacker.id,
      target: target.id,
      weapon: weapon.name,
      mode: frame.mode,
      attacks: roll.attacks,
      hits: roll.hits,
      crits: roll.crits,
      wounds: roll.wounds,
      unsaved: roll.unsaved,
      mortal: roll.mortal,
      damage: ward.taken,
      warded: roll.damage + roll.mortal - ward.taken,
      dice: { ...roll.dice, ward: ward.dice },
    });
    pending.set(target.id, (pending.get(target.id) ?? 0) + ward.taken);
  }
  for (const [id, amount] of pending) {
    const target = s.units[id]!;
    const res = allocateDamage(ctx, target, amount, `${attacker.name} (${frame.mode})`);
    if (res.destroyed && frame.mode === 'fight' && attacker.charged) {
      s.destroyedByChargeCombat = [...(s.destroyedByChargeCombat ?? []), id];
    }
  }
  clearExpiredEffects(s, 'attack');
}
