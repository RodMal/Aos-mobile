import { resolveWarscrollModels } from './base-size/warscroll-models.js';
import type { ModelBase } from '../geom/footprint.js';
import type { Ability, Warscroll, WeaponProfile } from './schema/index.js';
import { WYLDWOOD_PIECES } from './wyldwood.js';

/** A dice expression such as "3", "D6", "2D6" or "D3+3": roll `n` dice of `sides`, add `plus`. */
export interface Dice {
  n: number;
  sides: number;
  plus: number;
}

export type WeaponAbility =
  | { t: 'crit2Hits' }
  | { t: 'critAutoWound' }
  | { t: 'critMortal' }
  | { t: 'companion' }
  | { t: 'shootInCombat' }
  | { t: 'chargeDamage'; value: number }
  /** `keyword` is upper case; "CHARGE" means the target charged this turn. */
  | { t: 'anti'; keyword: string; rend: number };

/** A weapon with every characteristic parsed to numbers. */
export interface Weapon {
  id: string;
  name: string;
  kind: 'melee' | 'ranged';
  /** Inches; 0 for melee weapons. */
  range: number;
  attacks: Dice;
  /** Target numbers: a roll of this or more succeeds. */
  hit: number;
  wound: number;
  rend: number;
  damage: Dice;
  abilities: WeaponAbility[];
  /** The ability strings as printed, for display. */
  abilityText: string[];
}

export interface ModelProfile {
  base: ModelBase;
  champion: boolean;
}

/** A unit as fielded: a warscroll at a chosen size, with characteristics parsed. */
export interface UnitProfile {
  /** Unique per (warscroll, size): `<warscrollId>` or `<warscrollId>:r` when reinforced. */
  id: string;
  warscrollId: string;
  name: string;
  /** Upper case, with any "(...)" suffix removed: "WARD (5+)" is listed as "WARD". */
  keywords: string[];
  /** Inches. 0 for units that cannot move. */
  move: number;
  /** Set when Move is a dice expression such as 3D6". */
  moveDice: Dice | null;
  health: number;
  /** Save target number; 7 means no save. */
  save: number;
  control: number;
  /** Ward target number from a WARD (n+) keyword, or null. */
  ward: number | null;
  wizard: number;
  priest: number;
  banishment: number | null;
  weapons: Weapon[];
  /** Warscroll abilities with their printed text. Their effects live in src/rules. */
  abilities: Ability[];
  models: ModelProfile[];
  points: number;
  reinforced: boolean;
  isHero: boolean;
  isManifestation: boolean;
  isFactionTerrain: boolean;
}

const DICE_RE = /^(\d*)D(\d+)(?:\+(\d+))?$/i;

export function parseDice(raw: string): Dice {
  const s = raw.replace(/["\s]/g, '');
  if (s === '' || s === '-') return { n: 0, sides: 0, plus: 0 };
  const m = DICE_RE.exec(s);
  if (m) return { n: m[1] ? Number(m[1]) : 1, sides: Number(m[2]), plus: m[3] ? Number(m[3]) : 0 };
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`cannot parse dice expression "${raw}"`);
  return { n: 0, sides: 0, plus: n };
}

export function diceMean(d: Dice): number {
  return d.plus + (d.n * (d.sides + 1)) / 2;
}

export function diceMax(d: Dice): number {
  return d.plus + d.n * d.sides;
}

export function diceText(d: Dice): string {
  if (d.n === 0) return String(d.plus);
  return `${d.n === 1 ? '' : d.n}D${d.sides}${d.plus ? `+${d.plus}` : ''}`;
}

/** "3+" -> 3. "-" or "" -> `none`. */
function parseTarget(raw: string, none: number): number {
  const s = raw.trim();
  if (s === '' || s === '-') return none;
  const n = Number(s.replace('+', ''));
  if (!Number.isFinite(n)) throw new Error(`cannot parse target number "${raw}"`);
  return n;
}

function parseInches(raw: string | undefined): number {
  if (!raw) return 0;
  const s = raw.replace(/["\s]/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseWeaponAbility(raw: string): WeaponAbility | null {
  // BSData uses both a normal and a non-breaking hyphen.
  const s = raw.replace(/[‐‑]/g, '-').trim();
  const lower = s.toLowerCase();
  if (lower === 'crit (2 hits)') return { t: 'crit2Hits' };
  if (lower === 'crit (auto-wound)') return { t: 'critAutoWound' };
  if (lower === 'crit (mortal)') return { t: 'critMortal' };
  if (lower === 'companion') return { t: 'companion' };
  if (lower === 'shoot in combat') return { t: 'shootInCombat' };
  const charge = /^charge \(\+(\d+) damage\)$/i.exec(s);
  if (charge) return { t: 'chargeDamage', value: Number(charge[1]) };
  const anti = /^anti-(.+?)\s*\(\+(\d+) rend\)$/i.exec(s);
  if (anti) return { t: 'anti', keyword: anti[1]!.trim().toUpperCase(), rend: Number(anti[2]) };
  return null;
}

function buildWeapon(w: WeaponProfile): Weapon {
  const abilities: WeaponAbility[] = [];
  for (const raw of w.abilities) {
    const parsed = parseWeaponAbility(raw);
    if (!parsed) throw new Error(`unknown weapon ability "${raw}" on ${w.name}`);
    abilities.push(parsed);
  }
  return {
    id: w.id,
    name: w.name,
    kind: w.kind,
    range: w.kind === 'ranged' ? parseInches(w.range) : 0,
    attacks: parseDice(w.attacks),
    hit: parseTarget(w.hit, 7),
    wound: parseTarget(w.wound, 7),
    rend: parseTarget(w.rend, 0),
    damage: parseDice(w.damage),
    abilities,
    abilityText: w.abilities,
  };
}

function keywordLevel(keywords: readonly string[], name: string): number | null {
  for (const k of keywords) {
    const m = new RegExp(`^${name} \\((\\d+)\\+?\\)$`, 'i').exec(k);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Builds the playable profile of a warscroll at normal or reinforced size. */
export function buildProfile(warscroll: Warscroll, reinforced = false): UnitProfile {
  const move = warscroll.stats.move.replace(/["\s]/g, '');
  const moveIsDice = /D/i.test(move);
  const resolved = resolveWarscrollModels(warscroll, reinforced);
  const bareKeywords = warscroll.keywords.map((k) => k.replace(/\s*\(.*\)$/, '').toUpperCase());
  return {
    id: reinforced ? `${warscroll.id}:r` : warscroll.id,
    warscrollId: warscroll.id,
    name: warscroll.name,
    keywords: [...new Set(bareKeywords)],
    move: moveIsDice ? 0 : parseInches(move),
    moveDice: moveIsDice ? parseDice(move) : null,
    health: warscroll.stats.health ?? 1,
    save: parseTarget(warscroll.stats.save, 7),
    control: warscroll.stats.control ?? 0,
    ward: keywordLevel(warscroll.keywords, 'WARD'),
    wizard: keywordLevel(warscroll.keywords, 'WIZARD') ?? 0,
    priest: keywordLevel(warscroll.keywords, 'PRIEST') ?? 0,
    banishment: warscroll.stats.banishment ? parseTarget(warscroll.stats.banishment, 7) : null,
    weapons: warscroll.weapons.map(buildWeapon),
    abilities: warscroll.abilities,
    // Faction terrain is one piece with its own footprint, not the 32mm fallback base its
    // "Use model" entry resolves to.
    models: factionTerrainBase(warscroll, bareKeywords) ?? resolved.models.map((m) => ({
      base: m.base,
      champion: m.champion,
    })),
    points: (warscroll.points ?? 0) * (reinforced ? warscroll.reinforce.pointsMultiplier : 1),
    reinforced,
    isHero: warscroll.isHero,
    isManifestation: warscroll.isManifestation,
    isFactionTerrain: bareKeywords.includes('FACTION TERRAIN'),
  };
}

/**
 * Footprint of a faction terrain piece (owner's figures, 2026-11-11, approximate): the
 * Awakened Wyldwood is the first crescent traced from the owner's template, the Realmshaper
 * Engine a 6" square. Other faction terrain uses its curated `terrainFootprint`.
 */
function factionTerrainBase(warscroll: Warscroll, keywords: string[]): ModelProfile[] | null {
  if (!keywords.includes('FACTION TERRAIN')) return null;
  let base: ModelBase | undefined;
  if (warscroll.name === 'Awakened Wyldwood') {
    base = WYLDWOOD_PIECES[0]!;
  } else if (warscroll.name === 'Realmshaper Engine') {
    base = { kind: 'rect', lengthMm: 152.4, widthMm: 152.4 };
  } else {
    base = warscroll.terrainFootprint?.shape;
  }
  return base ? [{ base, champion: false }] : null;
}
