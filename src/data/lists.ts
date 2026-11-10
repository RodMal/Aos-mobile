import {
  FACTIONS,
  findEnhancement,
  findFormation,
  findLore,
  findTacticCard,
  findWarscroll,
  type BattleTacticCard,
  type FactionSlug,
  type Lore,
} from './catalog.js';
import { buildProfile, type UnitProfile } from './profile.js';
import type { Ability } from './schema/index.js';

/** One unit entry in an army list, written the way the GW app exports it. */
export interface ArmyListUnit {
  name: string;
  /** 0 is the general's regiment. */
  regiment: number;
  reinforced?: boolean;
  general?: boolean;
  /** Heroic trait, artefact or other enhancement names. */
  enhancements?: string[];
  /**
   * How many models carry each weapon, by weapon name, where the warscroll gives a choice
   * (e.g. 2 Moonstone Hammers in a unit of 6 Kroxigor; the rest carry the other weapon).
   * Not applied by the engine yet.
   */
  weapons?: Record<string, number>;
}

export interface ArmyList {
  id: string;
  title: string;
  faction: FactionSlug;
  formation: string;
  spellLore?: string;
  prayerLore?: string;
  manifestationLore?: string;
  tacticCards: [string, string];
  units: ArmyListUnit[];
  factionTerrain?: string;
  /** True for a stand-in list that has not been supplied by the player. */
  placeholder?: boolean;
}

export interface ArmyUnit {
  /** Index in the list; stable across games. */
  index: number;
  profile: UnitProfile;
  regiment: number;
  general: boolean;
  enhancements: { group: string; ability: Ability }[];
}

/** An army list with every name resolved against the data. */
export interface Army {
  list: ArmyList;
  faction: FactionSlug;
  factionName: string;
  units: ArmyUnit[];
  battleTraits: Ability[];
  formation: { name: string; abilities: Ability[] };
  spellLore: Lore | null;
  prayerLore: Lore | null;
  manifestationLore: Lore | null;
  tacticCards: BattleTacticCard[];
  factionTerrain: UnitProfile | null;
  points: number;
}

export function resolveArmy(list: ArmyList): Army {
  const faction = FACTIONS[list.faction];
  const units = list.units.map((u, index): ArmyUnit => {
    const enhancements = (u.enhancements ?? []).map((name) => findEnhancement(list.faction, name));
    return {
      index,
      profile: buildProfile(findWarscroll(list.faction, u.name), u.reinforced ?? false),
      regiment: u.regiment,
      general: u.general ?? false,
      enhancements,
    };
  });
  const formation = findFormation(list.faction, list.formation);
  const enhancementPoints = list.units
    .flatMap((u) => u.enhancements ?? [])
    .map((name) => enhancementCost(list.faction, name))
    .reduce((a, b) => a + b, 0);
  const lorePoints = [list.spellLore, list.prayerLore, list.manifestationLore]
    .map((name) => (name ? loreCost(list.faction, name) : 0))
    .reduce((a, b) => a + b, 0);
  return {
    list,
    faction: list.faction,
    factionName: faction.name,
    units,
    battleTraits: faction.battleTraits,
    formation: { name: formation.name, abilities: formation.abilities },
    spellLore: list.spellLore ? findLore(list.faction, list.spellLore) : null,
    prayerLore: list.prayerLore ? findLore(list.faction, list.prayerLore) : null,
    manifestationLore: list.manifestationLore
      ? findLore(list.faction, list.manifestationLore)
      : null,
    tacticCards: list.tacticCards.map(findTacticCard),
    factionTerrain: list.factionTerrain
      ? buildProfile(findWarscroll(list.faction, list.factionTerrain))
      : null,
    points: units.reduce((n, u) => n + u.profile.points, 0) + enhancementPoints + lorePoints,
  };
}

function enhancementCost(faction: FactionSlug, name: string): number {
  const want = name.toLowerCase();
  for (const table of FACTIONS[faction].enhancements) {
    const option = table.options.find((o) => o.name.toLowerCase() === want);
    if (option) return option.points ?? 0;
  }
  return 0;
}

function loreCost(faction: FactionSlug, name: string): number {
  const want = name.toLowerCase();
  return FACTIONS[faction].lores.find((l) => l.name.toLowerCase() === want)?.points ?? 0;
}

/**
 * The owner's Sylvaneth list (GW app export, app 1.39.0, data 488): Lords of the Clan,
 * 2000 points, 5 drops.
 */
export const SYLVANETH_LORDS_OF_THE_CLAN: ArmyList = {
  id: 'sylvaneth-lords-of-the-clan',
  title: 'Sylvaneth: Lords of the Clan',
  faction: 'sylvaneth',
  formation: 'Lords of the Clan',
  spellLore: 'Lore of the Deepwood',
  prayerLore: 'Lore of the Spirit-Song',
  manifestationLore: 'Aetherwrought Machineries',
  tacticCards: ['Flanking Firestorm', 'Burning for Vengeance'],
  units: [
    { name: 'Alarielle the Everqueen', regiment: 0, general: true },
    { name: 'Belthanos, First Thorn of Kurnoth', regiment: 1 },
    { name: 'Spirit of Durthu', regiment: 2, enhancements: ['Glamourweave'] },
    { name: 'Drycha Hamadreth', regiment: 3 },
    { name: 'Spite-Revenants', regiment: 3 },
    { name: 'Warsong Revenant', regiment: 4, enhancements: ['Realmroot Guide'] },
    { name: 'Dryads', regiment: 4 },
    { name: 'Dryads', regiment: 4, enhancements: ['Aspect of Heartwood'] },
  ],
  factionTerrain: 'Awakened Wyldwood',
};

/**
 * A second legal Seraphon army, kept as a fixture for the engine's unit tests. The app and
 * the simulations play the owner's list, `SERAPHON_SUNCLAW_STARHOST`.
 */
export const SERAPHON_PLACEHOLDER: ArmyList = {
  id: 'seraphon-placeholder',
  title: 'Seraphon: Sunclaw Starhost (placeholder)',
  faction: 'seraphon',
  formation: 'Sunclaw Starhost',
  spellLore: 'Lore of Celestial Manipulation',
  tacticCards: ['Siege of Ashes', 'Blazing Onslaught'],
  units: [
    { name: 'Lord Kroak', regiment: 0, general: true },
    { name: 'Saurus Guard', regiment: 0 },
    { name: 'Kroxigor', regiment: 0, reinforced: true },
    { name: 'Saurus Scar-Veteran on Aggradon', regiment: 1 },
    { name: 'Aggradon Lancers', regiment: 1, reinforced: true },
    { name: 'Saurus Warriors', regiment: 1, reinforced: true },
    { name: 'Skink Starpriest', regiment: 2 },
    { name: 'Skinks', regiment: 2 },
    { name: 'Spawn of Chotec', regiment: 2 },
  ],
  factionTerrain: 'Realmshaper Engine',
  placeholder: true,
};

/**
 * The owner's Seraphon list (Sigdex export, data v42): Sunclaw Starhost, 2000 points,
 * 3 drops, 137 wounds. Sigdex lists unit costs without enhancements: Coatl Familiar (20),
 * Armour Cruncher (10) and Morbid Conjuration (20) make up the last 50 points.
 */
export const SERAPHON_SUNCLAW_STARHOST: ArmyList = {
  id: 'seraphon-sunclaw-starhost',
  title: 'Seraphon: Sunclaw Starhost',
  faction: 'seraphon',
  formation: 'Sunclaw Starhost',
  spellLore: 'Lore of Celestial Manipulation',
  manifestationLore: 'Morbid Conjuration',
  tacticCards: ['Siege of Ashes', 'Legend of the Parch'],
  units: [
    { name: 'Lord Kroak', regiment: 0, general: true },
    { name: 'Kroxigor', regiment: 0, reinforced: true, weapons: { 'Moonstone Hammer': 2 } },
    { name: 'Sunblood Pack', regiment: 0, enhancements: ['Beastmaster'] },
    { name: 'Saurus Guard', regiment: 0, reinforced: true },
    { name: 'Saurus Astrolith Bearer', regiment: 1 },
    { name: 'Saurus Warriors', regiment: 1 },
    { name: 'Skink Starseer', regiment: 2, enhancements: ['Coatl Familiar'] },
    { name: 'Bastiladon with Ark of Sotek', regiment: 2, enhancements: ['Armour Cruncher'] },
    { name: 'Hunters of Huanchi with Dartpipes', regiment: 2 },
    { name: 'Hunters of Huanchi with Dartpipes', regiment: 2 },
  ],
  factionTerrain: 'Realmshaper Engine',
};

export const ARMY_LISTS: ArmyList[] = [
  SYLVANETH_LORDS_OF_THE_CLAN,
  SERAPHON_SUNCLAW_STARHOST,
  SERAPHON_PLACEHOLDER,
];
