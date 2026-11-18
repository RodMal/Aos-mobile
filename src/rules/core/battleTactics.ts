/**
 * GHB 2026-27 "Scourge of Aqshy" Battle Tactics (Advanced Rules, Battle Tactics 2026-27).
 *
 * Each army brings 2 of the season's 6 Battle Tactic cards. Each card has 3 sequential
 * tiers: Affray -> Strike -> Domination, worth 5 VP each. At the end of a player's turn
 * (unless that player seized the initiative this battle round), each of their 2 cards
 * whose current tier condition is met advances one step and scores 5 VP.
 *
 * Ported from aos-webapp `rules/battleTactics.ts` and adapted to polygon territories and
 * exact model footprints.
 */
import type {} from '../../data/battlefield.js';
import type { GameState, PlayerId, Scenario, TacticTier } from '../../engine/types.js';
import {
  BLAZING_ONSLAUGHT_ID,
  BURNING_FOR_VENGEANCE_ID,
  FLANKING_FIRESTORM_ID,
  LEGEND_OF_THE_PARCH_ID,
  SIEGE_OF_ASHES_ID,
  SMOKESCREEN_ID,
  BATTLE_TACTIC_STEP_VP,
  type ActiveTacticTier,
  type ScoredTactic,
} from './tactics/shared.js';
import { evaluateFlankingFirestorm } from './tactics/flankingFirestorm.js';
import { evaluateBurningForVengeance } from './tactics/burningForVengeance.js';
import { evaluateSiegeOfAshes } from './tactics/siegeOfAshes.js';
import { evaluateLegendOfTheParch } from './tactics/legendOfTheParch.js';
import { evaluateBlazingOnslaught } from './tactics/blazingOnslaught.js';
import { evaluateSmokescreen } from './tactics/smokescreen.js';

export * from './tactics/shared.js';

/** Evaluates a single Battle Tactic card tier for `player`. */
export function evaluateBattleTactic(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  cardId: string,
  tier: ActiveTacticTier,
): boolean {
  switch (cardId) {
    case FLANKING_FIRESTORM_ID:
      return evaluateFlankingFirestorm(scenario, state, player, tier);
    case BURNING_FOR_VENGEANCE_ID:
      return evaluateBurningForVengeance(scenario, state, player, tier);
    case SIEGE_OF_ASHES_ID:
      return evaluateSiegeOfAshes(scenario, state, player, tier);
    case LEGEND_OF_THE_PARCH_ID:
      return evaluateLegendOfTheParch(scenario, state, player, tier);
    case BLAZING_ONSLAUGHT_ID:
      return evaluateBlazingOnslaught(scenario, state, player, tier);
    case SMOKESCREEN_ID:
      return evaluateSmokescreen(scenario, state, player, tier);
    default:
      return false;
  }
}

function nextTier(tier: ActiveTacticTier): TacticTier {
  if (tier === 'affray') return 'strike';
  if (tier === 'strike') return 'domination';
  return 'completed';
}

function tacticSectionName(
  sections: { name: string; text: string }[],
  tier: ActiveTacticTier,
): string {
  const want = tier.toLowerCase();
  const sec = sections.find((s) => s.name.toLowerCase() === want);
  if (!sec) return tier;
  const colonIdx = sec.text.indexOf(':');
  return colonIdx > 0 ? sec.text.slice(0, colonIdx).trim() : sec.name;
}

/**
 * Evaluates both of `player`'s Battle Tactic cards at the end of their turn, advances
 * `player.tacticProgress` for each completed step, and returns the scored tactics.
 *
 * A player who seized the initiative this round cannot score any battle tactic on that turn.
 */
export function evaluateEndOfTurnTactics(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): ScoredTactic[] {
  if (state.seizedThisRound === player && state.turnIndex === 0) {
    return [];
  }
  const pState = state.players[player];
  pState.tacticProgress ??= {};
  const out: ScoredTactic[] = [];

  for (const card of scenario.armies[player].tacticCards) {
    const current = pState.tacticProgress[card.id] ?? 'affray';
    if (current === 'completed') continue;
    if (evaluateBattleTactic(scenario, state, player, card.id, current)) {
      pState.tacticProgress[card.id] = nextTier(current);
      out.push({
        cardId: card.id,
        cardName: card.name,
        tier: current,
        tacticName: tacticSectionName(card.sections, current),
        vp: BATTLE_TACTIC_STEP_VP,
      });
    }
  }
  return out;
}

/**
 * Live check for the tracker: whether the card's current tier would be met if the turn ended
 * on the present state. Null once the card is completed. Pure; does not change the state.
 */
export function liveTacticCheck(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  cardId: string,
): { tier: ActiveTacticTier; met: boolean } | null {
  const current = state.players[player].tacticProgress?.[cardId] ?? 'affray';
  if (current === 'completed') return null;
  return { tier: current, met: evaluateBattleTactic(scenario, state, player, cardId, current) };
}
