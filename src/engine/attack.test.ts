import { describe, expect, it } from 'vitest';
import {
  clampRollModifier,
  clampSaveModifier,
  hitSucceeds,
  rollAttackCount,
  rollAttackSequence,
  rollWard,
  saveSucceeds,
  woundSucceeds,
} from './attack.js';
import { NO_MODS, type AttackMods } from './expected.js';
import { RngCursor } from './rng.js';
import { ScriptedDice, weapon } from './test-helpers.js';

const SAVE_4 = { save: 4, ward: null };
const mods = (m: Partial<AttackMods>): AttackMods => ({ ...NO_MODS, ...m });

describe('modifier caps', () => {
  it('caps hit and wound modifiers at +1 and -1 however many stack', () => {
    expect(clampRollModifier(3)).toBe(1);
    expect(clampRollModifier(-2)).toBe(-1);
    expect(clampRollModifier(0)).toBe(0);
  });

  it('caps save modifiers at +1 but leaves penalties uncapped', () => {
    expect(clampSaveModifier(2)).toBe(1);
    expect(clampSaveModifier(-3)).toBe(-3);
  });
});

describe('roll success', () => {
  it('an unmodified 1 always fails, whatever the modifier', () => {
    expect(hitSucceeds(1, 2, 1)).toBe(false);
    expect(woundSucceeds(1, 2, 1)).toBe(false);
    expect(saveSucceeds(1, 2, 0, 1)).toBe(false);
  });

  it('an unmodified 6 always hits (it is a critical hit)', () => {
    expect(hitSucceeds(6, 6, -1)).toBe(true);
  });

  it('applies the modifier to the roll', () => {
    expect(hitSucceeds(3, 4, 1)).toBe(true);
    expect(hitSucceeds(4, 4, -1)).toBe(false);
    expect(woundSucceeds(3, 4, 1)).toBe(true);
  });

  it('rend worsens the save and a 7+ save cannot be made', () => {
    expect(saveSucceeds(4, 4, 0, 0)).toBe(true);
    expect(saveSucceeds(4, 4, 1, 0)).toBe(false);
    expect(saveSucceeds(4, 4, 1, 1)).toBe(true);
    expect(saveSucceeds(6, 7, 0, 1)).toBe(false);
  });
});

describe('attack count', () => {
  it('rolls a variable Attacks characteristic per model', () => {
    const w = weapon({ attacks: { n: 1, sides: 3, plus: 0 } });
    expect(rollAttackCount(new ScriptedDice([1, 3, 2]), w, 3, 0)).toBe(6);
  });

  it('champions add 1 attack, except with Companion weapons', () => {
    const w = weapon({ attacks: { n: 0, sides: 0, plus: 2 } });
    expect(rollAttackCount(new ScriptedDice([]), w, 5, 1)).toBe(11);
    const companion = weapon({
      attacks: { n: 0, sides: 0, plus: 2 },
      abilities: [{ t: 'companion' }],
    });
    expect(rollAttackCount(new ScriptedDice([]), companion, 5, 1)).toBe(10);
  });
});

describe('attack sequence', () => {
  it('hits, wounds, saves and damages in order', () => {
    // 4 attacks at 4+/4+, rend 0, damage 2, against a 4+ save.
    const w = weapon({ damage: { n: 0, sides: 0, plus: 2 } });
    const dice = new ScriptedDice([
      1,
      4,
      5,
      3, // hits: 4 and 5 hit
      4,
      2, // wounds: one wounds
      3, // save fails
    ]);
    const r = rollAttackSequence(dice, { weapon: w, attacks: 4, mods: NO_MODS, target: SAVE_4 });
    expect(r).toMatchObject({ hits: 2, crits: 0, wounds: 1, unsaved: 1, damage: 2, mortal: 0 });
    expect(dice.remaining).toBe(0);
  });

  it('+1 to hit turns a 3 into a hit; -1 turns a 4 into a miss', () => {
    const w = weapon();
    const plus = rollAttackSequence(new ScriptedDice([3, 1]), {
      weapon: w,
      attacks: 1,
      mods: mods({ hit: 1 }),
      target: SAVE_4,
    });
    expect(plus.hits).toBe(1);
    const minus = rollAttackSequence(new ScriptedDice([4]), {
      weapon: w,
      attacks: 1,
      mods: mods({ hit: -1 }),
      target: SAVE_4,
    });
    expect(minus.hits).toBe(0);
  });

  it('Crit (2 Hits) scores two hits per critical hit, each rolling to wound', () => {
    const w = weapon({ abilities: [{ t: 'crit2Hits' }] });
    const dice = new ScriptedDice([6, 6, 6, 1, 1, 1]);
    const r = rollAttackSequence(dice, { weapon: w, attacks: 1, mods: NO_MODS, target: SAVE_4 });
    expect(r.hits).toBe(2);
    expect(r.dice.wound).toHaveLength(2);
  });

  it('Crit (Auto-wound) skips the wound roll but still allows a save', () => {
    const w = weapon({ abilities: [{ t: 'critAutoWound' }] });
    const r = rollAttackSequence(new ScriptedDice([6, 5]), {
      weapon: w,
      attacks: 1,
      mods: NO_MODS,
      target: SAVE_4,
    });
    expect(r).toMatchObject({ wounds: 1, unsaved: 0, damage: 0 });
    expect(r.dice.wound).toEqual([]);
    expect(r.dice.save).toEqual([5]);
  });

  it("Crit (Mortal) inflicts the weapon's Damage as mortal damage and ends the sequence", () => {
    const w = weapon({ damage: { n: 1, sides: 3, plus: 0 }, abilities: [{ t: 'critMortal' }] });
    const r = rollAttackSequence(new ScriptedDice([6, 3]), {
      weapon: w,
      attacks: 1,
      mods: NO_MODS,
      target: SAVE_4,
    });
    expect(r).toMatchObject({ mortal: 3, wounds: 0, damage: 0 });
  });

  it('uses one critical ability when a weapon has several (the best expected)', () => {
    const w = weapon({ abilities: [{ t: 'crit2Hits' }, { t: 'critMortal' }] });
    const r = rollAttackSequence(new ScriptedDice([6]), {
      weapon: w,
      attacks: 1,
      mods: NO_MODS,
      target: { save: 2, ward: null },
    });
    expect(r.crit).toBe('critMortal');
    expect(r.mortal).toBe(1);
  });

  it('a unit with no save makes no save rolls', () => {
    const r = rollAttackSequence(new ScriptedDice([4, 4]), {
      weapon: weapon(),
      attacks: 1,
      mods: NO_MODS,
      target: { save: 7, ward: null },
    });
    expect(r).toMatchObject({ unsaved: 1, damage: 1 });
    expect(r.dice.save).toEqual([]);
  });

  it('variable Damage is rolled per unsaved wound and damage modifiers add to each', () => {
    const w = weapon({ damage: { n: 1, sides: 3, plus: 0 } });
    const dice = new ScriptedDice([4, 4, 4, 4, 1, 1, 1, 3]);
    const r = rollAttackSequence(dice, {
      weapon: w,
      attacks: 2,
      mods: mods({ damage: 1 }),
      target: SAVE_4,
    });
    expect(r.damage).toBe(1 + 1 + 3 + 1);
  });

  it('is reproducible for the same seed', () => {
    const input = { weapon: weapon(), attacks: 20, mods: NO_MODS, target: SAVE_4 };
    expect(rollAttackSequence(new RngCursor(5), input)).toEqual(
      rollAttackSequence(new RngCursor(5), input),
    );
  });
});

describe('ward', () => {
  it('rolls once per damage point and negates each roll that reaches the ward', () => {
    expect(rollWard(new ScriptedDice([5, 4, 6]), 3, 5)).toEqual({ taken: 1, dice: [5, 4, 6] });
  });

  it('does nothing without a ward', () => {
    expect(rollWard(new ScriptedDice([]), 3, null)).toEqual({ taken: 3, dice: [] });
  });
});
