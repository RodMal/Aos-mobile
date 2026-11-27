/**
 * Warscroll abilities of the universal manifestations other than their movement abilities (M4l):
 * Chronomantic Cogs (Mechanisms of Time), Quicksilver Swords (Dancing Blades), Purple Sun of
 * Shyish (Pull of the Nadir), Malevolent Maelstrom (Morbid Detonation, Necrotic Vortex) and
 * Soulsnare Shackles (Bound for the Great Oubliette, Multiple Parts). Printed text is in
 * `data/factions/universal.json`; readings in docs/RULES-DECISIONS.md S13 and I116 to I118.
 * The registered definitions are in `manifestation-defs.ts`; the behaviour that is more than a
 * modifier lives in `src/engine/manifestations.ts`.
 */
import {
  footprintsWithin,
  modelFootprint,
  profileOf,
  unitFootprints,
  unitsWithin,
} from '../query.js';
import type { GameState, Scenario, UnitState } from '../types.js';

export const MECHANISMS_OF_TIME_ID = 'ad92-932-6f56-1d97';
export const DANCING_BLADES_ID = '7b11-c623-fc14-4639';
export const PULL_OF_THE_NADIR_ID = 'c99-9240-9da1-d029';
export const MORBID_DETONATION_ID = 'b8a4-541-b62-cf62';
export const NECROTIC_VORTEX_ID = 'c711-ce6-1fb6-7abc';
export const BOUND_FOR_THE_GREAT_OUBLIETTE_ID = '6817-e507-443e-1ff4';
export const MULTIPLE_PARTS_ID = '9e13-160b-4a87-da4e';

/** Mechanisms of Time: the two effects (`ActiveEffect.data.mode`). */
export type TimeFlow = 'increase' | 'decrease';
/** The `choice` of the `ability` action that uses Mechanisms of Time. */
export const TIME_FLOW_CHOICES: Record<TimeFlow, string> = {
  increase: 'Increase Time Flow',
  decrease: 'Decrease Time Flow',
};

/** Mechanisms of Time's reach: Wizards within 3" of it start the ability, 12" is the area. */
export const MECHANISMS_WIZARD_RANGE = 3;
export const MECHANISMS_AREA = 12;
/** Pull of the Nadir's reach. */
export const NADIR_RANGE = 3;
/** Morbid Detonation: the points it needs, and its blast. */
export const MAELSTROM_POINTS_MAX = 6;
export const DETONATION_RANGE = 9;
/** Necrotic Vortex counts casts and slain models within this range. */
export const VORTEX_RANGE = 12;
/** Bound for the Great Oubliette: a part's reach, and the number of parts. */
export const OUBLIETTE_RANGE = 3;
export const SOULSNARE_PARTS = 3;
/** Multiple Parts: each part must be set up within 3" of at least 1 other part. */
export const PARTS_RANGE = 3;

/** True when the unit's warscroll has ability `id`. */
export function hasManifestationAbility(scenario: Scenario, unit: UnitState, id: string): boolean {
  return (
    unit.isManifestation === true && profileOf(scenario, unit).abilities.some((a) => a.id === id)
  );
}

/** True for the Soulsnare Shackles' kind of unit: several parts that stand and fall together. */
export const hasMultipleParts = (scenario: Scenario, unit: UnitState): boolean =>
  hasManifestationAbility(scenario, unit, MULTIPLE_PARTS_ID);

// ─── Necrotic Vortex: maelstrom points ──────────────────────────────────────────

/** The battlefield manifestations that have Necrotic Vortex. */
function vortexes(scenario: Scenario, state: GameState): UnitState[] {
  return state.unitOrder
    .map((id) => state.units[id]!)
    .filter(
      (u) =>
        u.isManifestation &&
        u.status === 'battlefield' &&
        hasManifestationAbility(scenario, u, NECROTIC_VORTEX_ID),
    );
}

/** One maelstrom point for `unit`, never more than 6 at once. */
export function addMaelstromPoint(unit: UnitState): void {
  unit.maelstrom = Math.min(MAELSTROM_POINTS_MAX, (unit.maelstrom ?? 0) + 1);
}

/** A unit successfully cast a spell: each Maelstrom within 12" of it gains a point. */
export function vortexCast(scenario: Scenario, state: GameState, caster: UnitState): void {
  for (const vortex of vortexes(scenario, state)) {
    if (vortex.id !== caster.id && unitsWithin(scenario, vortex, caster, VORTEX_RANGE)) {
      addMaelstromPoint(vortex);
    }
  }
}

/** Model `index` of `unit` is slain: each Maelstrom within 12" of it gains a point. */
export function vortexSlain(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  index: number,
): void {
  const found = vortexes(scenario, state).filter((v) => v.id !== unit.id);
  if (found.length === 0) return;
  const fp = modelFootprint(scenario, unit, index);
  for (const vortex of found) {
    if (footprintsWithin([fp], unitFootprints(scenario, vortex), VORTEX_RANGE)) {
      addMaelstromPoint(vortex);
    }
  }
}
