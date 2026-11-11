import { describe, expect, it } from 'vitest';
import {
  SERAPHON_PLACEHOLDER,
  SERAPHON_SUNCLAW_STARHOST,
  SYLVANETH_LORDS_OF_THE_CLAN,
} from '../data/lists.js';
import { weaponCarriers, weaponMods } from './combat.js';
import { createEngine, createScenario, profileOf } from './index.js';

describe('weapon loadouts', () => {
  it('splits a weapon choice between models as the army list says', () => {
    const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
    const state = createEngine(scenario).newGame(1);
    const krox = Object.values(state.units).find((u) => u.name === 'Kroxigor')!;
    const weapons = profileOf(scenario, krox).weapons;
    const hammer = weapons.find((w) => w.name === 'Moonstone Hammer')!;
    const maul = weapons.find((w) => w.name === 'Drakebite Maul')!;
    expect([...weaponCarriers(scenario, krox, hammer)!]).toEqual([0, 1]);
    expect([...weaponCarriers(scenario, krox, maul)!]).toEqual([2, 3, 4, 5]);
  });

  it('every model carries every weapon when the list says nothing', () => {
    const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
    const state = createEngine(scenario).newGame(1);
    const krox = state.units['1:2']!;
    expect(weaponCarriers(scenario, krox, profileOf(scenario, krox).weapons[0]!)).toBeNull();
  });
});

describe('All-out Attack', () => {
  it('gives +1 to hit only to the attacks it was bought for, not later ones that turn', () => {
    const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
    const state = createEngine(scenario).newGame(1);
    const unit = Object.values(state.units).find((u) => u.name === 'Kroxigor')!;
    const target = Object.values(state.units).find((u) => u.owner === 0)!;
    const melee = profileOf(scenario, unit).weapons.find((w) => w.kind === 'melee')!;
    const plain = weaponMods(scenario, state, unit, target, melee, 'fight').hit;
    // As left behind by All-out Attack bought earlier in the turn (e.g. in the shooting phase).
    const leftover = { ...unit, allOutAttack: true };
    expect(weaponMods(scenario, state, leftover, target, melee, 'fight').hit).toBe(plain);
    expect(
      weaponMods(scenario, state, unit, target, melee, 'fight', { allOutAttack: true }).hit,
    ).toBe(plain + 1);
  });
});
