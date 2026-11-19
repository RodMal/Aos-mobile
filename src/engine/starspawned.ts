/**
 * Starspawned (Sunblood Pack, M4f), kept apart from the ability registrations because damage
 * allocation calls it. Reading: docs/RULES-DECISIONS.md I101.
 */
import type { Ctx } from './ctx.js';
import { addEffect, effectsOnUnit } from './abilities/effects.js';
import { hasKeyword, profileOf, unitWhollyWithin, unitsOf } from './query.js';
import type { UnitState } from './types.js';

export const STARSPAWNED_ID = 'f571-744e-c103-8568';

const STARSPAWNED_USED = `${STARSPAWNED_ID}:used`;

/**
 * Starspawned: the first damage point that would be allocated to a Saurus or Kroxigor unit each
 * phase, while it is wholly within 12" of a friendly unit with the ability, is ignored. Returns
 * the damage still to be allocated.
 */
export function applyStarspawned(ctx: Ctx, unit: UnitState, amount: number): number {
  if (amount <= 0) return amount;
  const { scenario, s } = ctx;
  if (!hasKeyword(scenario, unit, 'SAURUS') && !hasKeyword(scenario, unit, 'KROXIGOR')) {
    return amount;
  }
  if (effectsOnUnit(s, unit.id).some((e) => e.id === STARSPAWNED_USED)) return amount;
  const source = unitsOf(s, unit.owner).find(
    (o) =>
      profileOf(scenario, o).abilities.some((a) => a.id === STARSPAWNED_ID) &&
      unitWhollyWithin(scenario, o, unit, 12),
  );
  if (!source) return amount;
  addEffect(s, {
    id: STARSPAWNED_USED,
    name: 'Starspawned',
    sourceUnit: source.id,
    targetUnit: unit.id,
    owner: unit.owner,
    expires: 'phase',
  });
  ctx.events.push({ t: 'note', text: 'Starspawned: 1 damage point ignored' });
  return amount - 1;
}
