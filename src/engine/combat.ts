/**
 * Shooting and fighting: which weapons can attack which targets, and resolving the attacks
 * of one unit. Range is measured base edge to base edge from each model, and only models in
 * range of the chosen target attack. Line of sight comes in M3.
 */
import { attackModifiers, sumModifiers } from '../rules/core/modifiers.js';
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
export function mayShoot(unit: UnitState): boolean {
  return (
    unit.status === 'battlefield' && !unit.shot && unit.moved !== 'run' && unit.moved !== 'retreat'
  );
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
  extra: { allOutAttack?: boolean; allOutDefence?: boolean } = {},
): AttackMods {
  return sumModifiers(
    attackModifiers(scenario, state, { attacker, target, weapon, mode, ...extra }),
    weapon,
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
  extra: { allOutAttack?: boolean; allOutDefence?: boolean } = {},
): number {
  const tp = profileOf(scenario, target);
  const attacks = expectedAttacks(
    weapon,
    indices.length,
    championsAmong(scenario, attacker, indices),
  );
  const mods = weaponMods(scenario, state, attacker, target, weapon, mode, extra);
  return expectedDamage(weapon, attacks, { save: tp.save, ward: tp.ward }, mods).total;
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
    if (!mayShoot(unit)) return [];
    const engaged = inCombat(scenario, state, unit);
    weapons = profile.weapons.filter(
      (w) => w.kind === 'ranged' && (!engaged || hasAbility(w, 'shootInCombat')),
    );
    if (weapons.length === 0) return [];
    const maxRange = Math.max(...weapons.map((w) => w.range));
    const own = unitBounds(scenario, unit);
    candidates = unitsOf(state, opponent(unit.owner)).filter((e) => {
      const b = unitBounds(scenario, e);
      return Math.hypot(b.x - own.x, b.y - own.y) - b.r - own.r <= maxRange + 1e-6;
    });
  } else {
    weapons = profile.weapons.filter((w) => w.kind === 'melee');
    if (weapons.length === 0) return [];
    candidates = enemiesWithin(scenario, state, unit, COMBAT_RANGE);
  }
  const out: WeaponTargets[] = [];
  for (const weapon of weapons) {
    const range = mode === 'shoot' ? weapon.range : COMBAT_RANGE;
    const targets: WeaponTargets['targets'] = [];
    for (const target of candidates) {
      const indices = modelsWithinRangeOf(scenario, unit, target, range);
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
    const range = frame.mode === 'shoot' ? weapon.range : COMBAT_RANGE;
    const indices = modelsWithinRangeOf(scenario, attacker, target, range);
    if (indices.length === 0) continue;
    const tp = profileOf(scenario, target);
    const attacks = rollAttackCount(
      ctx.rng,
      weapon,
      indices.length,
      championsAmong(scenario, attacker, indices),
    );
    const mods = weaponMods(scenario, s, attacker, target, weapon, frame.mode, {
      allOutAttack: frame.allOutAttack,
      allOutDefence: frame.defended.includes(target.id),
    });
    const roll = rollAttackSequence(ctx.rng, {
      weapon,
      attacks,
      mods,
      target: { save: tp.save, ward: tp.ward },
    });
    const ward = rollWard(ctx.rng, roll.damage + roll.mortal, tp.ward);
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
    allocateDamage(ctx, s.units[id]!, amount, `${attacker.name} (${frame.mode})`);
  }
}
