import { z } from 'zod';

/**
 * Base size model (ADR 0009). The zod schemas are the source of truth (ADR 0008); the
 * TypeScript types below are inferred from them. All objects are strict: unknown keys are
 * rejected rather than silently stripped.
 */

const positiveMm = z.number().positive().finite();

export const RoundBaseSchema = z.strictObject({
  kind: z.literal('round'),
  diameterMm: positiveMm,
});

/** From "LxWmm" in the data: AoS oval bases. */
export const OvalBaseSchema = z.strictObject({
  kind: z.literal('oval'),
  lengthMm: positiveMm,
  widthMm: positiveMm,
});

/** True rectangles only ever come from overrides. */
export const RectBaseSchema = z.strictObject({
  kind: z.literal('rect'),
  lengthMm: positiveMm,
  widthMm: positiveMm,
});

/** "Use model" in the data; needs an override, otherwise resolves to the fallback base. */
export const UseModelBaseSchema = z.strictObject({
  kind: z.literal('useModel'),
});

export const BaseShapeSchema = z.discriminatedUnion('kind', [
  RoundBaseSchema,
  OvalBaseSchema,
  RectBaseSchema,
  UseModelBaseSchema,
]);

export const BaseFractionSchema = z.strictObject({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});

export const BaseSizePartSchema = z.strictObject({
  /** Primary shape; for "A OR B" this is A. */
  shape: BaseShapeSchema,
  /** The other shapes of an "A OR B" line, in order. */
  alternatives: z.array(BaseShapeSchema),
  /** "1/8" prefix; absent when the line has no fraction. */
  fraction: BaseFractionSchema.optional(),
  /** True when the note contains the word "Champion". */
  champion: z.boolean(),
  /** Text inside the trailing parentheses, e.g. "Champion, Hunter Javelin". */
  note: z.string().optional(),
});

export const BaseSizeSourceSchema = z.enum(['data', 'override', 'fallback']);

export const BaseSizeSpecSchema = z.strictObject({
  /** The raw BSData string, always kept verbatim. */
  raw: z.string(),
  /** One part per line, in line order. Empty when the raw string could not be parsed. */
  parts: z.array(BaseSizePartSchema),
  source: BaseSizeSourceSchema,
  /** Warning strings, each prefixed with a stable code such as `BASE_SIZE_UNPARSED:`. */
  warnings: z.array(z.string()),
});

export type RoundBase = z.infer<typeof RoundBaseSchema>;
export type OvalBase = z.infer<typeof OvalBaseSchema>;
export type RectBase = z.infer<typeof RectBaseSchema>;
export type UseModelBase = z.infer<typeof UseModelBaseSchema>;
export type BaseShape = z.infer<typeof BaseShapeSchema>;
export type BaseFraction = z.infer<typeof BaseFractionSchema>;
export type BaseSizePart = z.infer<typeof BaseSizePartSchema>;
export type BaseSizeSource = z.infer<typeof BaseSizeSourceSchema>;
export type BaseSizeSpec = z.infer<typeof BaseSizeSpecSchema>;

/** Stable warning / finding codes used in `BaseSizeSpec.warnings` and the quality report. */
export const BASE_SIZE_CODES = {
  unparsed: 'BASE_SIZE_UNPARSED',
  fractionsSum: 'BASE_SIZE_FRACTIONS_SUM',
  mixedDenominators: 'BASE_SIZE_MIXED_DENOMINATORS',
  missingFraction: 'BASE_SIZE_MISSING_FRACTION',
  fallback: 'BASE_SIZE_FALLBACK',
  championCount: 'BASE_SIZE_CHAMPION_COUNT',
  championOverflow: 'BASE_SIZE_CHAMPION_OVERFLOW',
} as const;

export type BaseSizeCode = (typeof BASE_SIZE_CODES)[keyof typeof BASE_SIZE_CODES];

/** The base every model gets when the data gives no usable size (ADR 0009 step 6). */
export const FALLBACK_BASE: RoundBase = Object.freeze({ kind: 'round', diameterMm: 32 });
