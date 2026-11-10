import { z } from 'zod';
import { BaseSizeSpecSchema } from './base-size.js';
import { SlugSchema, SrcRefSchema } from './common.js';
import { TerrainFootprintSchema } from './terrain-footprint.js';

/**
 * Warscroll-level schemas (architecture.md, ADR 0017). Zod is the source of truth
 * (ADR 0008); the TypeScript types are inferred.
 */

const count = z.number().int().nonnegative();
const id = z.string().min(1);

/** A Melee or Ranged Weapon profile. Characteristics stay strings ("D6", "2+", "-"). */
export const WeaponProfileSchema = z.strictObject({
  /** BSData profile id. */
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(['melee', 'ranged']),
  /** Rng, ranged weapons only (e.g. `18"`). */
  range: z.string().optional(),
  attacks: z.string(),
  hit: z.string(),
  wound: z.string(),
  rend: z.string(),
  damage: z.string(),
  /** Weapon ability keywords split from the Ability column, e.g. "Crit (Mortal)"; "-" → []. */
  abilities: z.array(z.string()),
});

/** `Ability (<Kind>)` profile types seen in the data, camel-cased. */
export const AbilityKindSchema = z.enum([
  'passive',
  'activated',
  'spell',
  'prayer',
  'command',
  'fate',
  'bloodTithe',
]);

export const AbilitySchema = z.strictObject({
  /** BSData profile id. */
  id: z.string().min(1),
  name: z.string(),
  kind: AbilityKindSchema,
  timing: z.string().optional(),
  /** Declare text with BSData markup (`**bold**`, `^^keyword^^`) kept. */
  declare: z.string().optional(),
  /** Effect text with BSData markup kept. */
  effect: z.string(),
  /** `effect` with the `**` and `^^` markup stripped. */
  effectPlain: z.string(),
  castingValue: z.string().optional(),
  chantingValue: z.string().optional(),
  /** Command point cost of a command ability. */
  cost: z.string().optional(),
  fatePoints: z.string().optional(),
  usedBy: z.string().optional(),
  /** Ability keywords, upper-cased and stripped of markup (e.g. SPELL, UNLIMITED). */
  keywords: z.array(z.string()),
});

/** One `type="model"` entry of a unit (or the unit itself when it has no model entries). */
export const ModelGroupSchema = z.strictObject({
  /** BSData id of the model entry (the unit id for single-entry units such as manifestations). */
  id: z.string().min(1),
  name: z.string(),
  /** Models at the base unit size. */
  min: count,
  max: count,
  /** Models added per Reinforced (increment modifier repeating on the Reinforced entry). */
  perReinforce: count,
  /**
   * Extra champion models in this group per Reinforced (ADR 0033 §3): at `t` reinforcements
   * the group has `championCount + championsPerReinforce * t` champions. Only a
   * `CHAMPION (1/N)` keyword gives one (one champion per N models of the whole unit); absent
   * when 0, e.g. for plain `CHAMPION` units and units that cannot be reinforced.
   */
  championsPerReinforce: count.optional(),
  /** True when the group holds the unit's champion (Champion link or a "(Champion)" base line). */
  champion: z.boolean(),
  /**
   * Champion models in this group at the base unit size (0 when `champion` is false). It
   * never comes from a base-size numerator: plain `CHAMPION` gives the Champion link's max
   * (1), `CHAMPION (1/N)` gives max(1, floor(unit models / N)) (ADR 0033 §1). It is passed
   * to resolution as `champions.base` (resolveModelBases, resolveWarscrollModels), so a
   * "(Champion)" line covering more models than this (e.g. `5/10 32mm (Champion)`) splits
   * into the champions and an ordinary share that scales when reinforced (ADR 0033 §2).
   */
  championCount: count,
  base: BaseSizeSpecSchema,
});

/** Regiment option of a hero (ADR 0017 §1). Filled by M1-T06; empty until then. */
export const RegimentOptionSchema = z.strictObject({
  kind: z.enum(['keyword', 'warscroll', 'group']),
  /** Keyword name | warscroll id | helper category name. */
  value: z.string().min(1),
  /** kind 'group' only: resolved members in this catalogue. */
  warscrollIds: z.array(id).optional(),
  /** The grant adds Regimental Hero (hero units) rather than Regimental Option. */
  heroes: z.boolean().optional(),
  /** Mandatory companions: at least this many matching units. */
  min: count.optional(),
  /** Additive cap on units matching this option. */
  max: count.optional(),
  excludeKeywords: z.array(z.string()).optional(),
  excludeWarscrollIds: z.array(id).optional(),
  recognised: z.boolean(),
});

export const WarscrollStatsSchema = z.strictObject({
  move: z.string(),
  /** null when the profile says "-". */
  health: z.number().int().positive().nullable(),
  save: z.string(),
  /** Unit profile only; null when the profile says "-". */
  control: count.nullable().optional(),
  /** Manifestation profile only. */
  banishment: z.string().optional(),
});

export const ReinforceSchema = z.strictObject({
  /** A Reinforced entryLink sits on the unit's faction entryLink. */
  allowed: z.boolean(),
  /** Times the unit may be reinforced (0 when not allowed). */
  maxTimes: count,
  /** Points multiplier from the `multiply` points modifier conditioned on Reinforced; 1 when not allowed. */
  pointsMultiplier: z.number().positive(),
});

/** One model group at the undersize size (ADR 0035): its id and model count. */
export const UndersizeModelSchema = z.strictObject({
  /** ModelGroup.id of the same warscroll. */
  modelGroupId: id,
  count,
});

/**
 * A hero-unlocked smaller size of a warscroll (ADR 0035), read from a second root link with
 * the `Undersize Unit` category. It can never be reinforced.
 */
export const UndersizeOptionSchema = z.strictObject({
  /** BSData entryLink id of the undersize link (provenance). */
  linkId: id,
  /** BSData display name, e.g. "Dracothian Guard Concussors (1 model)". */
  name: z.string().min(1),
  /** The undersize link's points cost. */
  points: z.number().int().positive(),
  /** Models at undersize (= sum of `models[].count`). */
  unitSize: z.number().int().positive(),
  /** One entry per ModelGroup, in `models` order, champion groups included. */
  models: z.array(UndersizeModelSchema).min(1),
  /** Warscroll ids whose presence raises the limit, sorted and distinct; [] when not recognised. */
  unlockedBy: z.array(id),
  /** Limit raised per unlocking unit. */
  perUnlock: z.number().int().positive(),
  /** The unlock repeat sets includeChildForces: a hero in a Regiment of Renown counts. */
  countsRegimentOfRenown: z.boolean(),
  /** False when the unlock pattern is not the simple per-hero repeat (limit not modelled). */
  recognised: z.boolean(),
});

/**
 * A points-less unit added with its parent (ADR 0037), listed on the parent warscroll.
 */
export const CompanionSchema = z.strictObject({
  /** Warscroll id of the companion, in the same faction file. */
  warscrollId: id,
  /** BSData child entryLink id inside the parent's link (provenance). */
  linkId: id,
  /** Units added per parent unit: the child link's min (= max) selections constraint. */
  count: z.number().int().positive(),
});

const WarscrollObjectSchema = z.strictObject({
  /** BSData id of the unit selectionEntry (library or .gst). */
  id: z.string().min(1),
  slug: SlugSchema,
  name: z.string(),
  /** Factions this copy belongs to (the embedding faction). */
  factionIds: z.array(id).min(1),
  /** Visible upper-case keywords from categoryLinks (library entry + faction link), sorted. */
  keywords: z.array(z.string()),
  /** Name of the primary categoryLink (INFANTRY, HERO, MANIFESTATION, ...); null if none. */
  primaryCategory: z.string().nullable(),
  stats: WarscrollStatsSchema,
  /** Melee and ranged weapons from the unit, its models and their upgrades; deduped by id. */
  weapons: z.array(WeaponProfileSchema),
  abilities: z.array(AbilitySchema),
  models: z.array(ModelGroupSchema),
  /** Models at the base unit size (sum of model group minimums). */
  unitSize: count,
  reinforce: ReinforceSchema,
  /** Points from the faction entryLink; null when the link carries none (e.g. manifestations). */
  points: count.nullable(),
  isHero: z.boolean(),
  isUnique: z.boolean(),
  isManifestation: z.boolean(),
  /** Heroes only (ADR 0017); filled by M1-T06. */
  regimentOptions: z.array(RegimentOptionSchema),
  canBeGeneral: z.boolean(),
  /** Scourge of Ghyran/Aqshy variant → id of the base warscroll (ADR 0017). */
  variantOfId: z.string().optional(),
  legends: z.boolean(),
  pathToGlory: z.boolean(),
  /**
   * FACTION TERRAIN warscrolls only (ADR 0030 §2): the piece's footprint for deployment,
   * curated in `overrides/terrain-footprints.yaml` or FACTION_TERRAIN_DEFAULT_FOOTPRINT.
   * Separate from `models[].base`, which keeps the 32mm fallback (ADR 0020).
   */
  terrainFootprint: TerrainFootprintSchema.optional(),
  /** Hero-unlocked smaller size (ADR 0035); only when the faction file has an undersize link. */
  undersize: UndersizeOptionSchema.optional(),
  /** Points-less units added with this one (ADR 0037); non-empty, sorted by warscrollId. */
  companions: z.array(CompanionSchema).min(1).optional(),
  src: z.array(SrcRefSchema),
});

/**
 * A curated warscroll. The refinement checks the ADR 0035 undersize invariants (the build
 * fails on a breach): `unitSize` is the sum of `models[].count`, every `modelGroupId` is a
 * model group of the warscroll (one entry each, in data order), undersize is smaller and
 * cheaper than the regular size, and `recognised: false` implies `unlockedBy: []`. It also
 * checks that `companions` is sorted by warscrollId without duplicates (ADR 0037).
 */
export const WarscrollSchema = WarscrollObjectSchema.superRefine((w, ctx) => {
  const u = w.undersize;
  if (u) {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', path: ['undersize'], message });
    };
    const sum = u.models.reduce((n, m) => n + m.count, 0);
    if (sum !== u.unitSize) issue(`unitSize ${u.unitSize} is not the sum of models (${sum})`);
    const groupIds = w.models.map((m) => m.id);
    const optionIds = u.models.map((m) => m.modelGroupId);
    if (optionIds.join('\u0000') !== groupIds.join('\u0000')) {
      issue(`models must list every model group in order (${groupIds.join(', ')})`);
    }
    const regular = w.models.reduce((n, m) => n + m.min, 0);
    if (u.unitSize >= regular) issue(`unitSize ${u.unitSize} is not below ${regular}`);
    if (w.points === null) issue('a warscroll with an undersize option needs points');
    else if (u.points >= w.points) issue(`points ${u.points} are not below ${w.points}`);
    if (!u.recognised && u.unlockedBy.length > 0) issue('unrecognised options have no unlockers');
    const sorted = [...new Set(u.unlockedBy)].sort();
    if (sorted.join('\u0000') !== u.unlockedBy.join('\u0000')) {
      issue('unlockedBy must be sorted and distinct');
    }
  }
  const ids = (w.companions ?? []).map((c) => c.warscrollId);
  const sortedIds = [...new Set(ids)].sort();
  if (ids.join('\u0000') !== sortedIds.join('\u0000')) {
    ctx.addIssue({
      code: 'custom',
      path: ['companions'],
      message: 'companions must be sorted by warscrollId and distinct',
    });
  }
});

export type WeaponProfile = z.infer<typeof WeaponProfileSchema>;
export type AbilityKind = z.infer<typeof AbilityKindSchema>;
export type Ability = z.infer<typeof AbilitySchema>;
export type ModelGroup = z.infer<typeof ModelGroupSchema>;
export type RegimentOption = z.infer<typeof RegimentOptionSchema>;
export type WarscrollStats = z.infer<typeof WarscrollStatsSchema>;
export type Reinforce = z.infer<typeof ReinforceSchema>;
export type UndersizeModel = z.infer<typeof UndersizeModelSchema>;
export type UndersizeOption = z.infer<typeof UndersizeOptionSchema>;
export type Companion = z.infer<typeof CompanionSchema>;
export type Warscroll = z.infer<typeof WarscrollSchema>;
