import { describe, expect, it } from 'vitest';
import { INTO_THE_FIRE } from './battlefield.js';
import { DATA_VERSION, FACTIONS, LORES, TACTIC_CARDS, UNIVERSAL } from './catalog.js';
import {
  ARMY_LISTS,
  resolveArmy,
  SERAPHON_PLACEHOLDER,
  SERAPHON_SUNCLAW_STARHOST,
  SYLVANETH_LORDS_OF_THE_CLAN,
} from './lists.js';
import { buildProfile, parseDice, parseWeaponAbility } from './profile.js';
import { FactionSchema, LoresFileSchema } from './schema/index.js';
import loresJson from '../../data/lores.json';

describe('game data', () => {
  it('is pinned to one BSData commit', () => {
    expect(DATA_VERSION).toBe('28ca9405c89880a6cea0480603247993275dfb6b');
    expect(UNIVERSAL.dataVersion).toBe(DATA_VERSION);
    expect(FACTIONS.seraphon.dataVersion).toBe(DATA_VERSION);
  });

  it('matches the schemas', () => {
    for (const faction of [FACTIONS.sylvaneth, FACTIONS.seraphon, UNIVERSAL]) {
      expect(FactionSchema.safeParse(faction).success, faction.name).toBe(true);
    }
    expect(LoresFileSchema.safeParse(loresJson).success).toBe(true);
    expect(LORES.length).toBeGreaterThan(0);
    expect(TACTIC_CARDS.length).toBe(6);
  });

  it('builds a playable profile for every Sylvaneth and Seraphon warscroll', () => {
    for (const faction of [FACTIONS.sylvaneth, FACTIONS.seraphon, UNIVERSAL]) {
      for (const w of faction.warscrolls) {
        const p = buildProfile(w);
        expect(p.models.length, w.name).toBeGreaterThan(0);
        expect(p.health, w.name).toBeGreaterThan(0);
        for (const weapon of p.weapons) {
          expect(weapon.hit, `${w.name} ${weapon.name}`).toBeGreaterThanOrEqual(2);
          expect(weapon.wound, `${w.name} ${weapon.name}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

describe('parsing', () => {
  it('reads dice expressions', () => {
    expect(parseDice('3')).toEqual({ n: 0, sides: 0, plus: 3 });
    expect(parseDice('D6')).toEqual({ n: 1, sides: 6, plus: 0 });
    expect(parseDice('2D6')).toEqual({ n: 2, sides: 6, plus: 0 });
    expect(parseDice('D3+3')).toEqual({ n: 1, sides: 3, plus: 3 });
    expect(parseDice('-')).toEqual({ n: 0, sides: 0, plus: 0 });
  });

  it('reads weapon abilities, including the non-breaking hyphen BSData uses', () => {
    expect(parseWeaponAbility('Crit (2 Hits)')).toEqual({ t: 'crit2Hits' });
    expect(parseWeaponAbility('Anti‑Monster (+1 Rend)')).toEqual({
      t: 'anti',
      keyword: 'MONSTER',
      rend: 1,
    });
    expect(parseWeaponAbility('Anti-charge (+1 Rend)')).toEqual({
      t: 'anti',
      keyword: 'CHARGE',
      rend: 1,
    });
    expect(parseWeaponAbility('Charge (+1 Damage)')).toEqual({ t: 'chargeDamage', value: 1 });
    expect(parseWeaponAbility('Shoot In Combat')).toEqual({ t: 'shootInCombat' });
  });
});

describe('army lists', () => {
  it('resolves every list against the data', () => {
    for (const list of ARMY_LISTS) expect(() => resolveArmy(list), list.id).not.toThrow();
  });

  it("the owner's Sylvaneth list is exactly 2000 points with 30 models", () => {
    const army = resolveArmy(SYLVANETH_LORDS_OF_THE_CLAN);
    expect(army.points).toBe(2000);
    expect(army.units.reduce((n, u) => n + u.profile.models.length, 0)).toBe(30);
    expect(army.formation.abilities.map((a) => a.name)).toEqual(["Nature's Titans"]);
    expect(army.tacticCards.map((c) => c.name)).toEqual([
      'Flanking Firestorm',
      'Burning for Vengeance',
    ]);
    const alarielle = army.units[0]!.profile;
    expect(alarielle.ward).toBe(5);
    expect(alarielle.wizard).toBe(3);
    expect(alarielle.keywords).toContain('FLY');
    expect(army.manifestationLore?.summons?.length).toBe(3);
  });

  it("the owner's Seraphon list is exactly 2000 points with 43 models and 137 wounds", () => {
    const army = resolveArmy(SERAPHON_SUNCLAW_STARHOST);
    expect(army.points).toBe(2000);
    expect(army.units.reduce((n, u) => n + u.profile.models.length, 0)).toBe(43);
    expect(
      army.units.reduce((n, u) => n + u.profile.models.length * u.profile.health, 0),
    ).toBe(137);
    expect(army.formation.abilities.map((a) => a.name)).toEqual(['Vengeance of Azyr']);
    expect(army.manifestationLore?.summons?.length).toBe(4);
    expect(army.units.flatMap((u) => u.enhancements.map((e) => e.ability.name))).toEqual([
      'Beastmaster',
      'Coatl Familiar',
      'Armour Cruncher',
    ]);
  });

  it('the placeholder Seraphon list is 2000 points', () => {
    expect(resolveArmy(SERAPHON_PLACEHOLDER).points).toBe(2000);
  });
});

describe('battlefield', () => {
  it('has five objectives, both territories and a Place of Power in each territory', () => {
    const b = INTO_THE_FIRE;
    expect([b.width, b.height]).toEqual([60, 44]);
    expect(b.objectives).toHaveLength(5);
    expect(b.territories.A).toHaveLength(1);
    expect(b.territories.B).toHaveLength(1);
    expect(b.terrain.filter((t) => t.traits.includes('placeOfPower'))).toHaveLength(2);
  });
});
