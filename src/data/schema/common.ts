import { z } from 'zod';

/**
 * Shared primitives for the curated model (ADR 0007/0008). All objects are strict: unknown
 * keys are rejected rather than silently stripped.
 */

/** Semver of the curated JSON format; the `v1` data directory equals its major (ADR 0007). */
export const SCHEMA_VERSION = '1.2.0' as const;

/** Header carried by every generated file (ADR 0007). No timestamps. */
export const VersionHeaderSchema = z.strictObject({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** BSData submodule SHA the data was built from. */
  dataVersion: z.string().min(1),
  /** `@aos/bsdata-parser@<version>`. */
  generator: z.string().min(1),
});

/** Back-reference from a curated entity to the BSData nodes it came from (ADR 0005). */
export const SrcRefSchema = z.strictObject({
  /** Data file relative to `vendor/age-of-sigmar-4th/`. */
  file: z.string().min(1),
  /** Id of the BSData definition (selectionEntry, catalogue, ...). */
  entryId: z.string().min(1),
  /** Id of the entryLink that pulled the entry in, when there is one. */
  linkId: z.string().min(1).optional(),
  /** True when an override changed this entity (M1-T09). */
  override: z.boolean().optional(),
});

/** Lowercase ASCII words joined by dashes. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const GrandAllianceSchema = z.enum(['Order', 'Chaos', 'Death', 'Destruction']);

export type VersionHeader = z.infer<typeof VersionHeaderSchema>;
export type SrcRef = z.infer<typeof SrcRefSchema>;
export type GrandAlliance = z.infer<typeof GrandAllianceSchema>;
