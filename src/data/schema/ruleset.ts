import { z } from 'zod';
import { SrcRefSchema, VersionHeaderSchema } from './common.js';
import { RegimentOfRenownSchema } from './faction.js';

const count = z.number().int().nonnegative();

/** Matched-play composition constants (ADR 0010, ADR 0017 §1). */
export const RulesetSchema = z.strictObject({
  ...VersionHeaderSchema.shape,
  id: z.string().min(1),
  name: z.string().min(1),
  points: z.strictObject({
    default: z.number().int().positive(),
    options: z.array(z.number().int().positive()),
  }),
  regiments: z.strictObject({
    min: count,
    /** Includes any Regiment of Renown. */
    max: count,
    /** Includes the leader (ADR 0017 §4.2). */
    maxUnits: count,
    /** Includes the leader. */
    maxUnitsWithGeneral: count,
    leaders: count,
    allowedKeywords: z.array(z.string()),
    slotBonuses: z.array(z.strictObject({ warscrollId: z.string().min(1), plus: count })),
  }),
  regimentsOfRenown: z.strictObject({
    max: count,
    countsTowardRegiments: z.boolean(),
    /** Every Regiment of Renown linked from the GHB force, sorted by id. */
    list: z.array(RegimentOfRenownSchema),
  }),
  factionTerrain: z.strictObject({ max: count }),
  auxiliaries: z.strictObject({ allowed: z.boolean() }),
  battleTacticCards: z.strictObject({
    exactly: count,
    pool: z.array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string(),
        /** The card's characteristics in XML order (Card, Affray, Strike, Domination). */
        sections: z.array(z.strictObject({ name: z.string(), text: z.string() })),
      }),
    ),
  }),
  enhancements: z.strictObject({ heroicTraits: count, artefacts: count }),
  reinforce: z.strictObject({ pointsMultiplier: z.number().positive() }),
  legendsAllowed: z.boolean(),
  src: z.array(SrcRefSchema),
});

export type Ruleset = z.infer<typeof RulesetSchema>;
