import loresJson from '../../data/lores.json';
import rulesetJson from '../../data/ruleset.json';
import seraphonJson from '../../data/factions/seraphon.json';
import sylvanethJson from '../../data/factions/sylvaneth.json';
import universalJson from '../../data/factions/universal.json';
import type { Ability, Faction, Warscroll } from './schema/index.js';

/**
 * The BSData-derived game data (see data/SOURCE.md). The JSON was validated against the zod
 * schemas when BSData-parser generated it; `catalog.test.ts` re-validates the copies here.
 */
export type FactionSlug = 'sylvaneth' | 'seraphon';

export interface Lore {
  id: string;
  name: string;
  kind: 'spell' | 'prayer' | 'manifestation';
  abilities: Ability[];
  summons?: { abilityId: string; warscrollId: string }[];
}

export interface BattleTacticCard {
  id: string;
  name: string;
  sections: { name: string; text: string }[];
}

export const FACTIONS: Record<FactionSlug, Faction> = {
  sylvaneth: sylvanethJson as unknown as Faction,
  seraphon: seraphonJson as unknown as Faction,
};

export const UNIVERSAL = universalJson as unknown as Faction;

export const LORES: Lore[] = (loresJson as unknown as { lores: Lore[] }).lores;

export const TACTIC_CARDS: BattleTacticCard[] = (
  rulesetJson as unknown as { battleTacticCards: { pool: BattleTacticCard[] } }
).battleTacticCards.pool;

/** The BSData commit the data was generated from. */
export const DATA_VERSION: string = (sylvanethJson as { dataVersion: string }).dataVersion;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Finds a warscroll by exact name (case and punctuation insensitive) in a faction or universal. */
export function findWarscroll(faction: FactionSlug, name: string): Warscroll {
  const want = norm(name);
  for (const source of [FACTIONS[faction], UNIVERSAL]) {
    const hit = source.warscrolls.find((w) => norm(w.name) === want);
    if (hit) return hit;
  }
  throw new Error(`warscroll "${name}" not found in ${faction}`);
}

export function warscrollById(id: string): Warscroll {
  for (const source of [FACTIONS.sylvaneth, FACTIONS.seraphon, UNIVERSAL]) {
    const hit = source.warscrolls.find((w) => w.id === id);
    if (hit) return hit;
  }
  throw new Error(`warscroll id "${id}" not found`);
}

export function findLore(faction: FactionSlug, name: string): Lore {
  const want = norm(name);
  const ref = FACTIONS[faction].lores.find((l) => norm(l.name) === want);
  if (!ref) throw new Error(`lore "${name}" not found in ${faction}`);
  const lore = LORES.find((l) => l.id === ref.loreRef);
  if (!lore) throw new Error(`lore "${name}" (${ref.loreRef}) missing from lores.json`);
  return lore;
}

export function findTacticCard(name: string): BattleTacticCard {
  const want = norm(name);
  const card = TACTIC_CARDS.find((c) => norm(c.name) === want);
  if (!card) throw new Error(`battle tactic card "${name}" not found`);
  return card;
}

/** Finds an enhancement option (heroic trait, artefact, ...) by name. */
export function findEnhancement(
  faction: FactionSlug,
  name: string,
): { group: string; ability: Ability } {
  const want = norm(name);
  for (const group of FACTIONS[faction].enhancements) {
    for (const option of group.options) {
      if (norm(option.name) === want) return { group: group.name, ability: option.ability };
    }
  }
  throw new Error(`enhancement "${name}" not found in ${faction}`);
}

export function findFormation(faction: FactionSlug, name: string): Faction['battleFormations'][number] {
  const want = norm(name);
  const hit = FACTIONS[faction].battleFormations.find((f) => norm(f.name) === want);
  if (!hit) throw new Error(`battle formation "${name}" not found in ${faction}`);
  return hit;
}
