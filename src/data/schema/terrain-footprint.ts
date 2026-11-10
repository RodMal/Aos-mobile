import { z } from 'zod';
import { OvalBaseSchema, RectBaseSchema, RoundBaseSchema } from './base-size.js';

/**
 * Faction terrain footprint (ADR 0030 §2). A separate field from the model base: faction
 * terrain keeps the 32mm fallback base and the BASE_SIZE_FALLBACK warning (ADR 0020), while
 * the deployment engine and the board use this footprint as the piece's one-model token.
 * Footprints are curated in `overrides/terrain-footprints.yaml`; a FACTION TERRAIN warscroll
 * with no curated entry gets FACTION_TERRAIN_DEFAULT_FOOTPRINT.
 */

/** The `BaseShape` variants a footprint may use (no `useModel`). */
export const TerrainFootprintShapeSchema = z.discriminatedUnion('kind', [
  RoundBaseSchema,
  OvalBaseSchema,
  RectBaseSchema,
]);

export const TerrainFootprintSchema = z.strictObject({
  shape: TerrainFootprintShapeSchema,
  /** True when the shape only bounds an irregular model (or is the 6" x 4" default). */
  approximate: z.boolean(),
  /** Highest point in inches; absent = unknown (treated as taller than 1", ADR 0030 §4). */
  heightIn: z.number().positive().finite().optional(),
});

export type TerrainFootprintShape = z.infer<typeof TerrainFootprintShapeSchema>;
export type TerrainFootprint = z.infer<typeof TerrainFootprintSchema>;

/**
 * Footprint of a FACTION TERRAIN warscroll with no curated entry: a 6" x 4" rectangle
 * (152.4 x 101.6 mm; `lengthMm` is the long side), approximate, height unknown.
 */
export const FACTION_TERRAIN_DEFAULT_FOOTPRINT: TerrainFootprint = Object.freeze({
  shape: Object.freeze({ kind: 'rect', lengthMm: 152.4, widthMm: 101.6 } as const),
  approximate: true,
});

/** True when `fp` is the default footprint, i.e. nothing has been curated for the piece. */
export function isDefaultTerrainFootprint(fp: TerrainFootprint): boolean {
  const d = FACTION_TERRAIN_DEFAULT_FOOTPRINT;
  return (
    fp.shape.kind === 'rect' &&
    d.shape.kind === 'rect' &&
    fp.shape.lengthMm === d.shape.lengthMm &&
    fp.shape.widthMm === d.shape.widthMm &&
    fp.approximate === d.approximate &&
    fp.heightIn === undefined
  );
}

/** Quality finding codes for faction terrain footprints (ADR 0030 §2). Warnings only. */
export const TERRAIN_FOOTPRINT_CODES = {
  /** No curated footprint: the 6" x 4" default applies. */
  missing: 'TERRAIN_FOOTPRINT_MISSING',
  /** The footprint has no `heightIn`: units may not stand on it (treated as > 1"). */
  heightMissing: 'TERRAIN_HEIGHT_MISSING',
} as const;

export type TerrainFootprintCode =
  (typeof TERRAIN_FOOTPRINT_CODES)[keyof typeof TERRAIN_FOOTPRINT_CODES];
