/**
 * The NPC's tunable configuration. Version 0 is the baseline: every feature switch is off, so
 * the NPC plays exactly as `baseline.ts`. Later versions come from self-play training.
 */
import { z } from 'zod';

export const NpcConfigSchema = z
  .object({
    /** 0 is the baseline; each shipped champion has a higher version. */
    version: z.number().int().min(0),
    /** Evaluation weights by feature name. */
    weights: z.record(z.string(), z.number()),
    /** Priors (for example, how often an opponent acts a given way) by name. */
    priors: z.record(z.string(), z.number()),
    /** Feature switches by name; a feature that is absent or false is off. */
    features: z.record(z.string(), z.boolean()),
  })
  .strict();

export type NpcConfig = z.infer<typeof NpcConfigSchema>;
