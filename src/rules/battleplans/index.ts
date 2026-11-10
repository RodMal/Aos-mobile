/**
 * Battleplan-specific rules. Each battleplan says what a player scores at the end of their
 * turn. Twists, special abilities and battle tactics come in M3.
 */
import { controlledCount } from '../core/objectives.js';
import type { GameState, PlayerId } from '../../engine/types.js';

export interface ScoreLine {
  vp: number;
  reason: string;
}

export interface BattleplanRules {
  id: string;
  name: string;
  /** VP the player whose turn is ending scores, given objective control at that moment. */
  endOfTurnScore(state: GameState, player: PlayerId): ScoreLine[];
}

/**
 * GHB 2026-27 Into the Fire (card 1-1): 3VP for at least 1 objective, 3VP for 2 or more,
 * 4VP for more objectives than the opponent. Cumulative.
 */
export const INTO_THE_FIRE_RULES: BattleplanRules = {
  id: 'into-the-fire',
  name: 'Into the Fire',
  endOfTurnScore(state, player) {
    const mine = controlledCount(state, player);
    const theirs = controlledCount(state, player === 0 ? 1 : 0);
    const out: ScoreLine[] = [];
    if (mine >= 1) out.push({ vp: 3, reason: 'Controls at least 1 objective' });
    if (mine >= 2) out.push({ vp: 3, reason: 'Controls 2 or more objectives' });
    if (mine > theirs) out.push({ vp: 4, reason: 'Controls more objectives than the opponent' });
    return out;
  },
};

const BATTLEPLANS: Record<string, BattleplanRules> = {
  [INTO_THE_FIRE_RULES.id]: INTO_THE_FIRE_RULES,
};

/** The rules for a battlefield id; falls back to Into the Fire's (the shared GHB scoring). */
export function battleplanRules(battlefieldId: string): BattleplanRules {
  return BATTLEPLANS[battlefieldId] ?? INTO_THE_FIRE_RULES;
}
