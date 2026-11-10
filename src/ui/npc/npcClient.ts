/**
 * The computer opponent as the UI sees it: an async "what do you do now?".
 *
 * Today this answers with `engine.defaultAction` on the main thread. To use the real NPC,
 * replace `createNpcClient` with one that posts the state to a Web Worker wrapping `src/ai`
 * (for example `new Worker(new URL('../../worker/npc.worker.ts', import.meta.url),
 * { type: 'module' })`) and resolves with the action the worker sends back. Nothing else in
 * the UI needs to change.
 */
import type { Action, Engine, GameState } from '../../engine/index.js';

export interface NpcClient {
  chooseAction(state: GameState): Promise<Action>;
  dispose(): void;
}

export function createNpcClient(engine: Engine): NpcClient {
  return {
    chooseAction: (state) => Promise.resolve(engine.defaultAction(state)),
    dispose: () => {},
  };
}
