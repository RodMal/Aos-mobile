import { describe, expect, it } from 'vitest';
import {
  expectedAttacks,
  expectedDamage,
  pCrit,
  pHit,
  pSave,
  pWardFail,
  pWound,
} from './expected.js';
import { weapon } from './test-helpers.js';

// Golden values from aos-guru src/analysis/metrics/damage.test.ts (M3-004).
const SAVE_4 = { save: 4, ward: null };

describe('probabilities', () => {
  it('splits a hit roll into normal hits (2..5) and critical hits (6)', () => {
    expect(pCrit()).toBeCloseTo(1 / 6);
    expect(pHit(4)).toBeCloseTo(2 / 6);
    expect(pHit(2)).toBeCloseTo(4 / 6);
    expect(pHit(4, 1)).toBeCloseTo(3 / 6);
  });

  it('never wounds on a 1', () => {
    expect(pWound(2)).toBeCloseTo(5 / 6);
    expect(pWound(2, 1)).toBeCloseTo(5 / 6);
  });

  it('caps a save bonus at +1 and applies rend in full', () => {
    expect(pSave(4, 0)).toBeCloseTo(3 / 6);
    expect(pSave(4, 2)).toBeCloseTo(1 / 6);
    expect(pSave(4, 0, 3)).toBeCloseTo(4 / 6);
    expect(pSave(7, 0)).toBe(0);
  });

  it('wards', () => {
    expect(pWardFail(null)).toBe(1);
    expect(pWardFail(5)).toBeCloseTo(4 / 6);
    expect(() => pWardFail(7)).toThrow(RangeError);
  });
});

describe('expected damage golden values', () => {
  const club = weapon({
    attacks: { n: 0, sides: 0, plus: 4 },
    hit: 4,
    wound: 2,
    rend: 1,
    damage: { n: 0, sides: 0, plus: 2 },
  });

  it('G1: Gluttons x5 vs 4+ = 100/9, x10 = 200/9, vs 3+ = 25/3, vs 4+ ward 5+ = 200/27', () => {
    expect(expectedDamage(club, 20, SAVE_4).total).toBeCloseTo(100 / 9, 6);
    expect(expectedDamage(club, 40, SAVE_4).total).toBeCloseTo(200 / 9, 6);
    expect(expectedDamage(club, 20, { save: 3, ward: null }).total).toBeCloseTo(25 / 3, 6);
    expect(expectedDamage(club, 20, { save: 4, ward: 5 }).total).toBeCloseTo(200 / 27, 6);
  });

  it('G2: Crit (2 Hits), 12 attacks 4+/2+/1/1 vs 4+ = 40/9', () => {
    const scrap = weapon({ hit: 4, wound: 2, rend: 1, abilities: [{ t: 'crit2Hits' }] });
    expect(expectedDamage(scrap, 12, SAVE_4).total).toBeCloseTo(40 / 9, 6);
  });

  it('G3: Crit (Mortal), 2 attacks 4+/4+/-/1 vs 4+ = 0.5 (normal 1/6, mortal 1/3)', () => {
    const sling = weapon({ abilities: [{ t: 'critMortal' }] });
    const r = expectedDamage(sling, 2, SAVE_4);
    expect(r.normal).toBeCloseTo(1 / 6, 6);
    expect(r.mortal).toBeCloseTo(1 / 3, 6);
    expect(r.total).toBeCloseTo(0.5, 6);
  });

  it('G4: Anti-Cavalry +1 rend and Charge +1 damage (passed in as modifiers)', () => {
    const rider = weapon({
      attacks: { n: 0, sides: 0, plus: 3 },
      wound: 2,
      rend: 1,
      damage: { n: 0, sides: 0, plus: 2 },
    });
    const tusks = weapon({ wound: 2, rend: 1, abilities: [{ t: 'companion' }] });
    const riderOne = expectedDamage(rider, 3, SAVE_4, {
      hit: 0,
      wound: 0,
      save: 0,
      rend: 1,
      damage: 0,
    });
    expect(riderOne.total).toBeCloseTo(75 / 36, 6);
    const tusksOne = expectedDamage(tusks, 4, SAVE_4, {
      hit: 0,
      wound: 0,
      save: 0,
      rend: 0,
      damage: 1,
    });
    expect(tusksOne.total).toBeCloseTo(80 / 36, 6);
  });

  it('counts the champion attack, but not for Companion weapons', () => {
    const w = weapon({ attacks: { n: 0, sides: 0, plus: 2 } });
    expect(expectedAttacks(w, 5, 1)).toBe(11);
    expect(expectedAttacks(weapon({ abilities: [{ t: 'companion' }] }), 5, 1)).toBe(5);
    expect(expectedAttacks(weapon({ attacks: { n: 1, sides: 6, plus: 0 } }), 2, 0)).toBe(7);
  });
});
