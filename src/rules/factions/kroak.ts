/**
 * Lord Kroak and the Sunclaw Starhost formation (data/factions/seraphon.json):
 *
 * - Supreme Master of Order (244b-f6f2-322d-5345), passive: +2 to casting rolls, +1 to unbinding
 *   and banishment rolls; Kroak may unbind a Spell of an enemy Wizard anywhere and banish a
 *   manifestation anywhere.
 * - Arcane Vassal (6bfc-5f30-ec02-307), once per turn in any hero phase: the next Spell ability
 *   Kroak uses this phase is measured from a friendly Skink Wizard wholly within 18".
 * - Dead for Innumerable Ages (c5a7-920c-9ff8-652), end of any turn: forced while damaged.
 * - Vengeance of Azyr (7c7e-3757-9881-5bd7), Sunclaw Starhost, once per turn (army), end of any
 *   turn: up to 3 Saurus or Kroxigor units in combat pile in, then each may inflict D3 mortal
 *   damage on 2+ on an enemy unit in combat with it.
 *
 * Readings are in docs/RULES-DECISIONS.md (I82 to I88).
 */
import { legalTargetsForSpec } from '../../engine/abilities/effects.js';
import { COMBAT_RANGE, hasKeyword, inCombat, profileOf } from '../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitState } from '../../engine/types.js';

export const ARCANE_VASSAL_ID = '6bfc-5f30-ec02-307';
export const SUPREME_MASTER_ID = '244b-f6f2-322d-5345';
export const DEAD_FOR_AGES_ID = 'c5a7-920c-9ff8-652';
export const VENGEANCE_ID = '7c7e-3757-9881-5bd7';
/** How many units Vengeance of Azyr may pick. */
export const VENGEANCE_MAX = 3;

export function hasWarscrollAbility(scenario: Scenario, unit: UnitState, id: string): boolean {
  return profileOf(scenario, unit).abilities.some((a) => a.id === id);
}

/** Supreme Master of Order on a unit that is on the battlefield. */
export function hasSupremeMaster(scenario: Scenario, unit: UnitState): boolean {
  return unit.status === 'battlefield' && hasWarscrollAbility(scenario, unit, SUPREME_MASTER_ID);
}

export const supremeCastBonus = (scenario: Scenario, unit: UnitState): number =>
  hasSupremeMaster(scenario, unit) ? 2 : 0;

/** Unbinding and banishment rolls. */
export const supremeUnbindBonus = (scenario: Scenario, unit: UnitState): number =>
  hasSupremeMaster(scenario, unit) ? 1 : 0;

/** Whether `caster` is an enemy Wizard Supreme Master of Order may unbind from anywhere. */
export function isWizard(scenario: Scenario, unit: UnitState): boolean {
  return (profileOf(scenario, unit).wizard ?? 0) > 0;
}

/** The friendly Skink Wizards Arcane Vassal may pick for `unit`. */
export function arcaneVassalTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitState[] {
  if (unit.status !== 'battlefield' || !hasWarscrollAbility(scenario, unit, ARCANE_VASSAL_ID)) {
    return [];
  }
  return legalTargetsForSpec(scenario, state, unit, {
    side: 'friendly',
    range: 18,
    whollyWithin: true,
    keywords: ['SKINK'],
    filter: (sc, _st, _src, t) => t.id !== unit.id && isWizard(sc, t),
  });
}

/** The Skink Wizard `unit`'s next Spell is measured from (Arcane Vassal), if one is picked. */
export function vassalOf(state: GameState, unit: UnitState): UnitState | undefined {
  const eff = (state.effects ?? []).find(
    (e) => e.id === ARCANE_VASSAL_ID && e.sourceUnit === unit.id,
  );
  const vassal = eff ? state.units[eff.targetUnit] : undefined;
  return vassal && vassal.status === 'battlefield' ? vassal : undefined;
}

// ─── Vengeance of Azyr ─────────────────────────────────────────────────────────

export function hasVengeance(scenario: Scenario, player: PlayerId): boolean {
  return scenario.armies[player].formation.abilities.some((a) => a.id === VENGEANCE_ID);
}

/** Friendly Saurus and Kroxigor units in combat. */
export function vengeanceCandidates(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  if (!hasVengeance(scenario, player)) return [];
  return Object.values(state.units).filter(
    (u) =>
      u.owner === player &&
      u.status === 'battlefield' &&
      !u.isManifestation &&
      (hasKeyword(scenario, u, 'SAURUS') || hasKeyword(scenario, u, 'KROXIGOR')) &&
      inCombat(scenario, state, u),
  );
}

/** The enemy units in combat with `unit` that Vengeance of Azyr may pick. */
export function vengeanceFoes(scenario: Scenario, state: GameState, unit: UnitState): UnitState[] {
  if (unit.status !== 'battlefield') return [];
  return legalTargetsForSpec(scenario, state, unit, { side: 'enemy', range: COMBAT_RANGE });
}
