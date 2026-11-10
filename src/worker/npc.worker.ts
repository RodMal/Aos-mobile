/**
 * The computer opponent, off the main thread. The UI posts a game state; the worker answers
 * with the action the NPC chooses. The worker builds its own copy of the scenario and engine.
 */
import { chooseAction } from '../ai/baseline.js';
import type { Action, GameState } from '../engine/index.js';
import { engine } from '../game.js';

export interface NpcRequest {
  id: number;
  state: GameState;
}

export type NpcResponse = { id: number; action: Action } | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<NpcRequest>) => void) | null;
  postMessage(message: NpcResponse): void;
};

scope.onmessage = (event) => {
  const { id, state } = event.data;
  try {
    scope.postMessage({ id, action: chooseAction(engine, state) });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
