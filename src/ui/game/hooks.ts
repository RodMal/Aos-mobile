/** Small React hooks over the game store. */
import { useMemo } from 'react';
import type { Decision, GameState } from '../../engine/index.js';
import { engine } from './engine.js';
import { useGame } from './instance.js';

export function useGameState(): GameState {
  return useGame((s) => s.session.state);
}

export function useHuman() {
  return useGame((s) => s.session.humanPlayer);
}

export function useDecision(): Decision | null {
  const state = useGameState();
  return useMemo(() => engine.decision(state), [state]);
}

/** The decision, only when the human must answer it. */
export function useHumanDecision(): Decision | null {
  const d = useDecision();
  const human = useHuman();
  return d && d.player === human ? d : null;
}
