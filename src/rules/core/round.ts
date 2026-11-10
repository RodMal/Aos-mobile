/**
 * Start of the battle round: priority, seizing the initiative, the underdog and command
 * points (GHB 2026-27 Core Rules 12.0; Commands 2026-27 1.1; Battle Tactics 2026-27 2.0).
 * Ported from aos-webapp `rules/priority.ts` and `rules/commandPoints.ts`.
 */
import type { GameState, PlayerId } from '../../engine/types.js';

export const BASE_CP_PER_ROUND = 4;
export const UNDERDOG_CP_BONUS = 1;
/** A double turn is not a seize when the opponent leads by this many VP or more. */
export const SEIZE_VP_LEAD_EXEMPTION = 11;

/**
 * Winner of the priority roll. A tie goes to the player who took the first turn of the
 * previous round (it is not re-rolled).
 */
export function priorityWinner(rolls: [number, number], previousFirst: PlayerId): PlayerId {
  if (rolls[0] === rolls[1]) return previousFirst;
  return rolls[0] > rolls[1] ? 0 : 1;
}

/**
 * True when `first` seizes the initiative: they won the roll, went second last round,
 * chose to go first, and their opponent does not lead by 11 VP or more.
 */
export function seizes(
  state: GameState,
  rollWinner: PlayerId,
  previousFirst: PlayerId,
  first: PlayerId,
): boolean {
  if (first !== rollWinner || first === previousFirst) return false;
  const other: PlayerId = first === 0 ? 1 : 0;
  return state.players[other].vp - state.players[first].vp < SEIZE_VP_LEAD_EXEMPTION;
}

/**
 * The underdog for the round: the opponent of whoever last seized the initiative, else the
 * player with fewer VP, else nobody.
 */
export function underdog(state: GameState): PlayerId | null {
  if (state.seizedBy !== undefined && state.seizedBy !== null) return state.seizedBy === 0 ? 1 : 0;
  const [a, b] = [state.players[0].vp, state.players[1].vp];
  if (a < b) return 0;
  if (b < a) return 1;
  return null;
}

/** Command points `player` receives at the start of the round. */
export function roundCommandPoints(state: GameState, player: PlayerId): number {
  return BASE_CP_PER_ROUND + (underdog(state) === player ? UNDERDOG_CP_BONUS : 0);
}
