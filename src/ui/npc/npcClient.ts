/**
 * The computer opponent as the UI sees it: an async "what do you do now?".
 *
 * The NPC (`src/ai`) runs in a Web Worker so the board stays responsive while it thinks.
 * If a worker cannot be started, or it fails, the same NPC runs on the main thread instead.
 */
import { chooseAction } from '../../ai/baseline.js';
import type { Action, Engine, GameState } from '../../engine/index.js';
import type { NpcRequest, NpcResponse } from '../../worker/npc.worker.js';

export interface NpcClient {
  chooseAction(state: GameState): Promise<Action>;
  dispose(): void;
}

export function createNpcClient(engine: Engine): NpcClient {
  const local = (state: GameState): Action => chooseAction(engine, state);
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { state: GameState; resolve: (action: Action) => void }>();

  /** Stops using the worker and answers everything still waiting on the main thread. */
  const fallBack = (): void => {
    worker?.terminate();
    worker = null;
    for (const { state, resolve } of pending.values()) resolve(local(state));
    pending.clear();
  };

  try {
    worker = new Worker(new URL('../../worker/npc.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<NpcResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      entry.resolve('action' in event.data ? event.data.action : local(entry.state));
    };
    worker.onerror = fallBack;
  } catch {
    worker = null;
  }

  return {
    chooseAction(state) {
      if (!worker) return Promise.resolve(local(state));
      const id = nextId++;
      return new Promise<Action>((resolve) => {
        pending.set(id, { state, resolve });
        const request: NpcRequest = { id, state };
        worker!.postMessage(request);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
