import { z } from 'zod';
import { GrandAllianceSchema, SlugSchema, SrcRefSchema, VersionHeaderSchema } from './common.js';
import { AbilitySchema, WarscrollSchema } from './warscroll.js';

/** Faction-level schemas (architecture.md, ADR 0017). */

const id = z.string().min(1);

export const EnhancementSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  ability: AbilitySchema,
  /** GHB 2026-27 points cost after ruleset modifiers; 0 is omitted. */
  points: z.number().int().positive().optional(),
  restrictions: z.strictObject({
    /** Parsed from `raw`; only narrows eligibility. */
    keywords: z.array(z.string()).optional(),
    excludeKeywords: z.array(z.string()).optional(),
    /** Authoritative: units whose root entryLink links the table (ADR 0017). */
    eligibleWarscrollIds: z.array(id),
    /** The "Enhancement Restrictions" text as written. */
    raw: z.string().optional(),
    /** Whether `raw` matched the restriction grammar. */
    recognised: z.boolean(),
  }),
  /**
   * Set when the option belongs to a seasonal rules publication (GHB 2026-27: Scourge of
   * Aqshy), taken from the BSData publicationId on the option or on the sub-group that holds
   * it (ADR 0023 §1). A "seasonal table" is a table whose options all have `season`.
   */
  season: z.strictObject({ publicationId: z.string().min(1), name: z.string().min(1) }).optional(),
});

/** An enhancement group (Heroic Traits, Artefacts of Power, other tables). */
export const EnhancementTableSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(['heroicTrait', 'artefact', 'other']),
  /** Per army. */
  max: z.number().int().nonnegative(),
  options: z.array(EnhancementSchema),
});

/** A lore option a faction can pick (content lives in lores.json, M1-T06). */
export const LoreSchema = z.strictObject({
  /** Option selectionEntry id. */
  id: z.string().min(1),
  /** Content group name. */
  name: z.string(),
  kind: z.enum(['spell', 'prayer', 'manifestation']),
  /** lores.json content id. */
  loreRef: z.string().min(1),
  /** Option cost (e.g. Forbidden Power 20); free lores omit it. */
  points: z.number().int().positive().optional(),
  /** Manifestation lores only: the warscrolls its spells summon (faction or universal). */
  warscrollIds: z.array(id).optional(),
});

/** A spell, prayer or manifestation summon paired with the warscroll it summons. */
export const LoreSummonSchema = z.strictObject({
  /** Profile id of the summoning spell / prayer. */
  abilityId: id,
  warscrollId: id,
});

/** Lore content (`lores.json`), shared by every faction whose options point at it. */
export const LoreContentSchema = z.strictObject({
  /** Content selectionEntryGroup id (usually in Lores.cat). */
  id,
  name: z.string(),
  kind: z.enum(['spell', 'prayer', 'manifestation']),
  abilities: z.array(AbilitySchema),
  /** Manifestation lores only. */
  summons: z.array(LoreSummonSchema).optional(),
  src: z.array(SrcRefSchema),
});

/** `data/v1/lores.json`: every lore content referenced by a faction, sorted by id. */
export const LoresFileSchema = z.strictObject({
  ...VersionHeaderSchema.shape,
  lores: z.array(LoreContentSchema),
});

export const BattleFormationSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  abilities: z.array(AbilitySchema),
  /** GHB 2026-27 points cost of the formation (e.g. 20); free formations omit it. */
  points: z.number().int().positive().optional(),
});

export const RegimentOfRenownSchema = z.strictObject({
  /** Id of the hidden GHB forceEntry of this Regiment of Renown. */
  id,
  name: z.string(),
  points: z.number().int().nonnegative(),
  /** Distinct warscrolls in the regiment, sorted. */
  warscrollIds: z.array(id),
  /** Each unit with its count (e.g. `Immortis Guard` ×2) and a faction file that holds it. */
  units: z.array(
    z.strictObject({
      warscrollId: id,
      count: z.number().int().positive(),
      /** The RoR fields this unit at its undersize size (ADR 0035), e.g. Valnir's Stormwing. */
      undersize: z.literal(true).optional(),
      factionId: id.optional(),
    }),
  ),
  /** Catalogue ids of the factions that may take it (may include an Army of Renown). */
  allowedFactionIds: z.array(id),
  /** The "Regiment of Renown: <name>" ability entry. */
  abilities: z.array(AbilitySchema),
});

const FactionObjectSchema = z.strictObject({
  ...VersionHeaderSchema.shape,
  /** BSData catalogue id, or "universal" for the pseudo-faction (ADR 0017 §4.3). */
  id: z.string().min(1),
  slug: SlugSchema,
  name: z.string().min(1),
  /** null only for the universal pseudo-faction. */
  grandAlliance: GrandAllianceSchema.nullable(),
  battleTraits: z.array(AbilitySchema),
  battleFormations: z.array(BattleFormationSchema),
  warscrollIds: z.array(id),
  warscrolls: z.array(WarscrollSchema),
  enhancements: z.array(EnhancementTableSchema),
  lores: z.array(LoreSchema),
  regimentsOfRenown: z.array(RegimentOfRenownSchema),
  armyOfRenown: z.strictObject({ parentFactionId: z.string().min(1) }).optional(),
  /** In the GHB 2026-27 Regiment force list and not legends (ADR 0017). */
  matchedPlay: z.boolean(),
  /** True only for factions/universal.json. */
  universal: z.boolean(),
  legends: z.boolean(),
  pathToGlory: z.boolean(),
  src: z.array(SrcRefSchema),
});

/**
 * A faction file. The refinement checks the ADR 0037 §1 companion invariants (the build
 * fails on a breach): every companion is a warscroll of the same file with `points: null`,
 * not FACTION TERRAIN, not a manifestation and without companions of its own, and it is not
 * granted by a regiment option or fielded by a Regiment of Renown. Invariant 3's "no root
 * link" and invariant 4's `min = max` are parser checks (the JSON does not record links).
 */
export const FactionSchema = FactionObjectSchema.superRefine((f, ctx) => {
  const byId = new Map(f.warscrolls.map((w) => [w.id, w]));
  const companionIds = new Set(
    f.warscrolls.flatMap((w) => (w.companions ?? []).map((c) => c.warscrollId)),
  );
  if (companionIds.size === 0) return;
  const granted = new Set<string>();
  for (const w of f.warscrolls) {
    for (const o of w.regimentOptions) {
      if (o.kind === 'warscroll') granted.add(o.value);
      for (const wid of o.warscrollIds ?? []) granted.add(wid);
    }
  }
  for (const ror of f.regimentsOfRenown) for (const u of ror.units) granted.add(u.warscrollId);
  for (const cid of [...companionIds].sort()) {
    const issue = (message: string): void => {
      ctx.addIssue({
        code: 'custom',
        path: ['warscrolls'],
        message: `companion ${cid}: ${message}`,
      });
    };
    const c = byId.get(cid);
    if (!c) {
      issue('is not a warscroll of this faction file');
      continue;
    }
    if (c.points !== null) issue('must have points: null');
    if (c.keywords.includes('FACTION TERRAIN')) issue('must not be FACTION TERRAIN');
    if (c.isManifestation) issue('must not be a manifestation');
    if (c.companions) issue('must not have companions of its own');
    if (granted.has(cid)) issue('must not be a regiment option grant or a Regiment of Renown unit');
  }
});

export type Enhancement = z.infer<typeof EnhancementSchema>;
export type EnhancementTable = z.infer<typeof EnhancementTableSchema>;
export type Lore = z.infer<typeof LoreSchema>;
export type LoreSummon = z.infer<typeof LoreSummonSchema>;
export type LoreContent = z.infer<typeof LoreContentSchema>;
export type LoresFile = z.infer<typeof LoresFileSchema>;
export type BattleFormation = z.infer<typeof BattleFormationSchema>;
export type RegimentOfRenown = z.infer<typeof RegimentOfRenownSchema>;
export type Faction = z.infer<typeof FactionSchema>;
