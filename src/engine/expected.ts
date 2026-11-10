/**
 * Expected damage of a weapon against a target: pure probability, no dice. Used for
 * `WeaponTargets.expectedDamage` (display and the NPC) and to pick a critical-hit ability
 * when a weapon has several.
 *
 * Ported from aos-guru `src/analysis/metrics/probability.ts` and `damage.ts`, extended with
 * the hit, wound, save, rend and damage modifiers this engine computes for an attack.
 */
import { diceMean, type Weapon } from '../data/profile.js';

/** Probability of an unmodified critical hit (a 6). */
export function pCrit(): number {
  return 1 / 6;
}

/**
 * Probability of a successful hit that is not a critical hit: rolls 2 to 5 that reach
 * `hit` after `mod`. An unmodified 1 always fails; a 6 is counted by `pCrit`.
 */
export function pHit(hit: number, mod = 0): number {
  let n = 0;
  for (let r = 2; r <= 5; r++) if (r + mod >= hit) n++;
  return n / 6;
}

/** Probability of a successful wound roll. An unmodified 1 always fails. */
export function pWound(wound: number, mod = 0): number {
  let n = 0;
  for (let r = 2; r <= 6; r++) if (r + mod >= wound) n++;
  return n / 6;
}

/**
 * Probability of passing a save. `save` 7 (or null) means no save. Positive save modifiers
 * are capped at +1; rend and negative modifiers are not capped. An unmodified 1 fails.
 */
export function pSave(save: number | null, rend: number, saveModifier = 0): number {
  if (save === null || save >= 7) return 0;
  const mod = Math.min(saveModifier, 1);
  let n = 0;
  for (let r = 2; r <= 6; r++) if (r + mod - rend >= save) n++;
  return n / 6;
}

/** Probability that a damage point gets past a ward roll; 1 with no ward. */
export function pWardFail(ward: number | null): number {
  if (ward === null) return 1;
  if (!Number.isInteger(ward) || ward < 2 || ward > 6) {
    throw new RangeError(`invalid ward ${ward}: expected 2..6 or null`);
  }
  return (ward - 1) / 6;
}

export type CritAbility = 'crit2Hits' | 'critAutoWound' | 'critMortal';

export function critAbilities(weapon: Weapon): CritAbility[] {
  const out: CritAbility[] = [];
  for (const a of weapon.abilities) {
    if (a.t === 'crit2Hits' || a.t === 'critAutoWound' || a.t === 'critMortal') out.push(a.t);
  }
  return out;
}

/** Modifiers in force for an attack, already capped where the rules cap them. */
export interface AttackMods {
  hit: number;
  wound: number;
  /** Save roll modifier (capped at +1, uncapped below). */
  save: number;
  /** Rend added to the weapon's Rend (Anti-X and the like). */
  rend: number;
  /** Damage added to each point of the weapon's Damage. */
  damage: number;
}

export const NO_MODS: AttackMods = { hit: 0, wound: 0, save: 0, rend: 0, damage: 0 };

export interface TargetDefence {
  /** Save target number; 7 means no save. */
  save: number;
  ward: number | null;
}

export interface ExpectedDamage {
  normal: number;
  mortal: number;
  total: number;
}

/** Expected damage per attack (after saves and wards) for one critical-hit choice. */
function perAttack(
  weapon: Weapon,
  mods: AttackMods,
  target: TargetDefence,
  crit: CritAbility | null,
): ExpectedDamage {
  const dmg = Math.max(0, diceMean(weapon.damage) + mods.damage);
  const ph = pHit(weapon.hit, mods.hit);
  const pc = pCrit();
  const pw = pWound(weapon.wound, mods.wound);
  const pUnsaved = 1 - pSave(target.save, weapon.rend + mods.rend, mods.save);
  const pwf = pWardFail(target.ward);
  const perWound = pUnsaved * dmg;
  let critNormal = 0;
  let critMortal = 0;
  switch (crit) {
    case null:
      critNormal = pw * perWound;
      break;
    case 'crit2Hits':
      critNormal = 2 * pw * perWound;
      break;
    case 'critAutoWound':
      critNormal = perWound;
      break;
    case 'critMortal':
      critMortal = dmg;
      break;
  }
  const normal = (ph * pw * perWound + pc * critNormal) * pwf;
  const mortal = pc * critMortal * pwf;
  return { normal, mortal, total: normal + mortal };
}

/**
 * The critical-hit ability to use. A weapon with several must pick one before the attack
 * sequence starts; the engine takes the one with the highest expected damage.
 */
export function chooseCrit(
  weapon: Weapon,
  mods: AttackMods,
  target: TargetDefence,
): CritAbility | null {
  const options = critAbilities(weapon);
  if (options.length <= 1) return options[0] ?? null;
  let best = options[0]!;
  let bestValue = -1;
  for (const c of options) {
    const v = perAttack(weapon, mods, target, c).total;
    if (v > bestValue) {
      best = c;
      bestValue = v;
    }
  }
  return best;
}

/** Mean number of attacks `models` models make, with `champions` of them adding 1. */
export function expectedAttacks(weapon: Weapon, models: number, champions: number): number {
  const companion = weapon.abilities.some((a) => a.t === 'companion');
  return models * diceMean(weapon.attacks) + (companion ? 0 : Math.min(champions, models));
}

/** Expected damage of `attacks` attacks with `weapon` against `target`. */
export function expectedDamage(
  weapon: Weapon,
  attacks: number,
  target: TargetDefence,
  mods: AttackMods = NO_MODS,
): ExpectedDamage {
  const crit = chooseCrit(weapon, mods, target);
  const one = perAttack(weapon, mods, target, crit);
  return { normal: one.normal * attacks, mortal: one.mortal * attacks, total: one.total * attacks };
}
