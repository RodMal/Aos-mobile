import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario } from '../../engine/index.js';
import { weapon } from '../../engine/test-helpers.js';
import {
  antiRend,
  attackModifiers,
  chargeDamage,
  sumModifiers,
  type Modifier,
} from './modifiers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const state = createEngine(scenario).newGame(1);
const dryads = state.units['0:6']!;
const kroxigor = state.units['1:2']!; // INFANTRY
const scarVeteran = state.units['1:3']!; // CAVALRY

describe('Anti-X (+1 Rend)', () => {
  const antiInfantry = weapon({ abilities: [{ t: 'anti', keyword: 'INFANTRY', rend: 1 }] });

  it('adds rend against a target with the keyword only', () => {
    expect(antiRend(scenario, antiInfantry, kroxigor)).toBe(1);
    expect(antiRend(scenario, antiInfantry, scarVeteran)).toBe(0);
  });

  it('is cumulative', () => {
    const two = weapon({
      abilities: [
        { t: 'anti', keyword: 'INFANTRY', rend: 1 },
        { t: 'anti', keyword: 'SERAPHON', rend: 1 },
      ],
    });
    expect(antiRend(scenario, two, kroxigor)).toBe(2);
  });

  it('reads Anti-charge as "the target charged this turn"', () => {
    const antiCharge = weapon({ abilities: [{ t: 'anti', keyword: 'CHARGE', rend: 1 }] });
    expect(antiRend(scenario, antiCharge, kroxigor)).toBe(0);
    expect(antiRend(scenario, antiCharge, { ...kroxigor, charged: true })).toBe(1);
  });
});

describe('Charge (+1 Damage)', () => {
  const lance = weapon({ abilities: [{ t: 'chargeDamage', value: 1 }] });
  it('applies only when the attacking unit charged', () => {
    expect(chargeDamage(lance, dryads)).toBe(0);
    expect(chargeDamage(lance, { ...dryads, charged: true })).toBe(1);
  });
});

describe('sumModifiers', () => {
  const plain = weapon();
  const companion = weapon({ abilities: [{ t: 'companion' }] });
  const m = (stat: Modifier['stat'], value: number, appliesToCompanion = false): Modifier => ({
    stat,
    value,
    source: 'test',
    appliesToCompanion,
  });

  it('caps hit and wound at +1/-1 and save at +1 only', () => {
    expect(
      sumModifiers([m('hit', 1), m('hit', 1), m('wound', -1), m('wound', -1)], plain),
    ).toMatchObject({ hit: 1, wound: -1 });
    expect(sumModifiers([m('save', 1), m('save', 1)], plain).save).toBe(1);
    expect(sumModifiers([m('save', -1), m('save', -1)], plain).save).toBe(-2);
  });

  it('Companion weapons ignore friendly positive modifiers but take negative ones', () => {
    expect(sumModifiers([m('hit', 1), m('damage', 1)], companion)).toMatchObject({
      hit: 0,
      damage: 0,
    });
    expect(sumModifiers([m('hit', -1)], companion).hit).toBe(-1);
  });

  it('All-out Attack (marked as applying to Companion) still counts for Companion weapons', () => {
    expect(sumModifiers([m('hit', 1, true)], companion).hit).toBe(1);
  });
});

describe('attackModifiers', () => {
  const w = weapon();
  it('All-out Attack gives +1 to hit; All-out Defence +1 to save', () => {
    const mods = sumModifiers(
      attackModifiers(scenario, state, {
        attacker: dryads,
        target: kroxigor,
        weapon: w,
        mode: 'fight',
        allOutAttack: true,
        allOutDefence: true,
      }),
      w,
    );
    expect(mods).toMatchObject({ hit: 1, save: 1 });
  });

  it('a unit that used All-out Attack this turn saves at -1', () => {
    const mods = sumModifiers(
      attackModifiers(scenario, state, {
        attacker: dryads,
        target: { ...kroxigor, allOutAttack: true },
        weapon: w,
        mode: 'fight',
      }),
      w,
    );
    expect(mods.save).toBe(-1);
  });
});
