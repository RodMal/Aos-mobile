import { describe, expect, it } from 'vitest';
import {
  SERAPHON_PLACEHOLDER,
  SERAPHON_SUNCLAW_STARHOST,
  SYLVANETH_LORDS_OF_THE_CLAN,
} from '../data/lists.js';
import { weaponCarriers } from './combat.js';
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
