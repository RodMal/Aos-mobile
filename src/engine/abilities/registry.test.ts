import { describe, expect, it } from 'vitest';
import { FACTIONS, LORES, UNIVERSAL, warscrollById } from '../../data/catalog.js';
import { COMMAND_ABILITIES } from './commands.js';
import { allRegisteredAbilities, getAbility } from './effects.js';
import { LORE_ABILITIES } from './lores.js';

describe('ability registry', () => {
  it('registers command and lore abilities', () => {
    expect(COMMAND_ABILITIES.length).toBeGreaterThanOrEqual(3);
    expect(LORE_ABILITIES.length).toBeGreaterThanOrEqual(16);
    const bsdataAbilities = allRegisteredAbilities().filter((a) => a.bsdata);
    expect(bsdataAbilities.length).toBeGreaterThanOrEqual(16);
  });

  it('matches every bsdata ability id and exact name in data/', () => {
    const catalogIndex = new Map<string, string>();
    for (const lore of LORES) {
      for (const ab of lore.abilities) {
        catalogIndex.set(ab.id, ab.name);
      }
    }
    for (const faction of [FACTIONS.sylvaneth, FACTIONS.seraphon, UNIVERSAL]) {
      for (const ws of faction.warscrolls) {
        for (const ab of ws.abilities) {
          catalogIndex.set(ab.id, ab.name);
        }
      }
      for (const trait of faction.battleTraits ?? []) {
        catalogIndex.set(trait.id, trait.name);
      }
      for (const fm of faction.battleFormations ?? []) {
        for (const ab of fm.abilities) {
          catalogIndex.set(ab.id, ab.name);
        }
      }
      for (const group of faction.enhancements ?? []) {
        for (const opt of group.options) {
          catalogIndex.set(opt.ability.id, opt.ability.name);
        }
      }
    }

    for (const def of allRegisteredAbilities()) {
      if (!def.bsdata) continue;
      const expectedName = catalogIndex.get(def.id);
      expect(expectedName, `missing BSData ability id ${def.id}`).toBeDefined();
      expect(def.name).toBe(expectedName);
    }
  });

  it('resolves every summon ability warscrollId to a manifestation warscroll', () => {
    const summons = allRegisteredAbilities().filter((a) => a.kind === 'summon');
    expect(summons.length).toBeGreaterThanOrEqual(7);
    for (const def of summons) {
      expect(def.summonWarscrollId).toBeDefined();
      const ws = warscrollById(def.summonWarscrollId!);
      expect(ws.isManifestation).toBe(true);
    }
  });

  it('registers all 20 M3a lore and warscroll spell abilities', () => {
    const expectedIds = [
      // Lore of the Deepwood
      '97df-e136-9fb4-5aca',
      '4ea1-b08a-3684-8d35',
      '77cf-59bd-fc8e-f6c7',
      // Lore of the Spirit-Song
      'a865-102f-ce95-480c',
      '4c37-4bd5-f9d5-170a',
      '1b5b-a2e8-6dd3-17fb',
      // Lore of Celestial Manipulation
      '78d-5a7e-a6c9-7674',
      'e0c2-6f59-3b19-9e51',
      '6086-ce9b-38be-28b2',
      // Aetherwrought Machineries
      '678b-96e1-66bb-1de8',
      'c402-d205-c59f-e84b',
      'd4da-e543-192d-84ae',
      // Morbid Conjuration
      '1b29-60f4-48d2-a6bb',
      '1f2c-ca29-2c5b-24ba',
      'ee70-f212-c079-a752',
      '36e0-4b94-aeb-67ac',
      // Warscroll Spells
      'b4bf-ef71-9dfe-e837',
      'a924-fd6e-9278-4d4c',
      'f7bf-5a9-2828-a74',
      '2209-9b15-d3f-15ed',
    ];
    for (const id of expectedIds) {
      expect(getAbility(id), `expected ability ${id} to be registered`).toBeDefined();
    }
  });
});
