/**
 * Celestial Conduit (Saurus Astrolith Bearer, 153d-3737-615b-b904): after a successful cast, for
 * the rest of the turn, +3 to the control scores of friendly Seraphon units wholly within 12" of
 * the Bearer. Kept apart from the other Seraphon rules so objective control can read it without
 * a cycle. Readings: docs/RULES-DECISIONS.md I104.
 */
import { hasKeyword, unitWhollyWithin } from '../../engine/query.js';
import type { GameState, Scenario, UnitState } from '../../engine/types.js';

export const CELESTIAL_CONDUIT_ID = '153d-3737-615b-b904';
export const CONDUIT_CONTROL_BONUS = 3;
export const CONDUIT_RANGE = 12;

/**
 * What the Conduits in play add to `unit`'s control score: 3 for each one whose Bearer is on the
 * battlefield with the unit wholly within 12" of it (the Bearer itself counts).
 */
export function conduitControlBonus(scenario: Scenario, state: GameState, unit: UnitState): number {
  if (unit.status !== 'battlefield' || !hasKeyword(scenario, unit, 'SERAPHON')) return 0;
  let bonus = 0;
  for (const e of state.effects ?? []) {
    if (e.id !== CELESTIAL_CONDUIT_ID || e.owner !== unit.owner) continue;
    const bearer = state.units[e.sourceUnit];
    if (!bearer || bearer.status !== 'battlefield') continue;
    if (bearer.id === unit.id || unitWhollyWithin(scenario, bearer, unit, CONDUIT_RANGE)) {
      bonus += CONDUIT_CONTROL_BONUS;
    }
  }
  return bonus;
}
