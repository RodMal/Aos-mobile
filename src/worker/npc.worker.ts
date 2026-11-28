/**
 * The computer opponent, off the main thread. The UI posts a game state; the worker answers
 * with the action the NPC chooses. The worker builds its own copy of the scenario and engine.
 */
import { chooseAction } from '../ai/baseline.js';
import { chooseNpcAction, loadChampion } from '../ai/index.js';
import type { Action, GameState } from '../engine/index.js';
import { engine } from '../game.js';

export interface NpcRequest {
  id: number;
  state: GameState;
  /** 'baseline' is for the test-only e2e page; normal play always uses the champion. */
  npc: 'champion' | 'baseline';
}

export type NpcResponse = { id: number; action: Action } | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<NpcRequest>) => void) | null;
  postMessage(message: NpcResponse): void;
};

scope.onmessage = (event) => {
  const { id, state, npc } = event.data;
  try {
    const action =
      npc === 'baseline'
        ? chooseAction(engine, state)
        : chooseNpcAction(engine, state, loadChampion());
    scope.postMessage({ id, action });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
