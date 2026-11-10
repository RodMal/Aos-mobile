/**
 * The attack sequence for one weapon against one target: hit, wound, save, damage. Pure:
 * the dice come from the cursor it is given. Wards are rolled when damage is allocated
 * (see `rollWard`), so every source of damage passes through them.
 *
 * Ported from aos-webapp `rules/combat.ts`, `weaponAbilities.ts` and `dice.ts`
 * (GHB 2026-27 Core Rules 16.0-20.0), re-typed for this engine's `Weapon`.
 */
import type { Weapon } from '../data/profile.js';
import { rollDice } from './ctx.js';
import { chooseCrit, type AttackMods, type CritAbility, type TargetDefence } from './expected.js';
import type { RngCursor } from './rng.js';

/** Hit and wound modifiers are capped at +1 and -1 (Core Rules 17.1). */
export function clampRollModifier(m: number): number {
  return Math.max(-1, Math.min(1, m));
}

/** Save modifiers are capped at +1 and have no floor (Core Rules 17.1). */
export function clampSaveModifier(m: number): number {
  return Math.min(1, m);
}

/** A hit roll succeeds on an unmodified 6 (a critical hit) or a modified roll that reaches
 * the target; an unmodified 1 always fails. */
export function hitSucceeds(die: number, hit: number, mod: number): boolean {
  if (die === 6) return true;
  return die !== 1 && die + mod >= hit;
}

/** An unmodified 1 always fails. */
export function woundSucceeds(die: number, wound: number, mod: number): boolean {
  return die !== 1 && die + mod >= wound;
}

/** `save` 7 means no save. Rend is subtracted from the roll; an unmodified 1 fails. */
export function saveSucceeds(die: number, save: number, rend: number, mod: number): boolean {
  if (save >= 7) return false;
  return die !== 1 && die + mod - rend >= save;
}

export function hasAbility(weapon: Weapon, t: Weapon['abilities'][number]['t']): boolean {
  return weapon.abilities.some((a) => a.t === t);
}

/**
 * Attacks made by `models` models with `weapon`. A variable Attacks characteristic is
 * rolled per model. `champions` of those models add 1, except with Companion weapons.
 */
export function rollAttackCount(
  rng: RngCursor,
  weapon: Weapon,
  models: number,
  champions: number,
): number {
  const bonus = hasAbility(weapon, 'companion') ? 0 : Math.min(champions, models);
  let n = bonus;
  for (let i = 0; i < models; i++) n += Math.max(0, rollDice(rng, weapon.attacks));
  return n;
}

export interface AttackInput {
  weapon: Weapon;
  attacks: number;
  /** Already capped (see `sumModifiers`). */
  mods: AttackMods;
  target: TargetDefence;
  /** Force a critical-hit ability; by default the best one is chosen. */
  crit?: CritAbility | null;
}

export interface AttackRoll {
  attacks: number;
  hits: number;
  crits: number;
  wounds: number;
  /** Wounds that got past the save. */
  unsaved: number;
  /** Mortal damage from Crit (Mortal), before wards. */
  mortal: number;
  /** Damage from unsaved wounds, before wards. */
  damage: number;
  crit: CritAbility | null;
  dice: { hit: number[]; wound: number[]; save: number[] };
}

export function rollAttackSequence(rng: RngCursor, input: AttackInput): AttackRoll {
  const { weapon, mods, target } = input;
  const crit = input.crit !== undefined ? input.crit : chooseCrit(weapon, mods, target);
  const damageRoll = (): number => Math.max(0, rollDice(rng, weapon.damage) + mods.damage);

  // 1. Hit rolls. An unmodified 6 is a critical hit.
  const hitDice: number[] = [];
  let hits = 0;
  let crits = 0;
  for (let i = 0; i < input.attacks; i++) {
    const die = rng.int(1, 6);
    hitDice.push(die);
    if (die === 6) crits++;
    else if (hitSucceeds(die, weapon.hit, mods.hit)) hits++;
  }
  let toWound = hits;
  let autoWounds = 0;
  let mortal = 0;
  if (crit === 'crit2Hits') toWound += 2 * crits;
  else if (crit === 'critAutoWound') autoWounds = crits;
  else if (crit === 'critMortal') {
    // Mortal damage equal to the Damage characteristic; the sequence ends for those.
    for (let i = 0; i < crits; i++) mortal += damageRoll();
  } else toWound += crits;
  const totalHits = hits + crits + (crit === 'crit2Hits' ? crits : 0);

  // 2. Wound rolls.
  const woundDice: number[] = [];
  let wounds = autoWounds;
  for (let i = 0; i < toWound; i++) {
    const die = rng.int(1, 6);
    woundDice.push(die);
    if (woundSucceeds(die, weapon.wound, mods.wound)) wounds++;
  }

  // 3. Save rolls, one per wound (none at all for a unit without a save).
  const saveDice: number[] = [];
  let unsaved = 0;
  const rend = Math.max(0, weapon.rend + mods.rend);
  for (let i = 0; i < wounds; i++) {
    if (target.save >= 7) {
      unsaved++;
      continue;
    }
    const die = rng.int(1, 6);
    saveDice.push(die);
    if (!saveSucceeds(die, target.save, rend, mods.save)) unsaved++;
  }

  // 4. Damage: rolled per unsaved wound for a variable Damage characteristic.
  let damage = 0;
  for (let i = 0; i < unsaved; i++) damage += damageRoll();

  return {
    attacks: input.attacks,
    hits: totalHits,
    crits,
    wounds,
    unsaved,
    mortal,
    damage,
    crit,
    dice: { hit: hitDice, wound: woundDice, save: saveDice },
  };
}

/** Ward rolls: one per damage point; each roll that reaches `ward` negates that point. */
export function rollWard(
  rng: RngCursor,
  damage: number,
  ward: number | null,
): { taken: number; dice: number[] } {
  if (ward === null || damage <= 0) return { taken: Math.max(0, damage), dice: [] };
  const dice: number[] = [];
  let taken = 0;
  for (let i = 0; i < damage; i++) {
    const die = rng.int(1, 6);
    dice.push(die);
    if (die < ward) taken++;
  }
  return { taken, dice };
}
