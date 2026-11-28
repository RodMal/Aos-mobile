/**
 * The computer opponent as the UI sees it: an async "what do you do now?".
 *
 * The NPC (`src/ai`) runs in a Web Worker so the board stays responsive while it thinks.
 * If a worker cannot be started, or it fails, the same NPC runs on the main thread instead.
 */
import { chooseAction } from '../../ai/baseline.js';
import { chooseNpcAction, loadChampion } from '../../ai/index.js';
import type { Action, Engine, GameState } from '../../engine/index.js';
import type { NpcRequest, NpcResponse } from '../../worker/npc.worker.js';

export interface NpcClient {
  chooseAction(state: GameState): Promise<Action>;
  dispose(): void;
}

/**
 * Which NPC plays. Normal play always uses the champion and ignores the URL. Only the test-only
 * `?e2e` page honours `npc=`: it plays the baseline unless the URL says `npc=champion`.
 */
export function npcChoice(search: string): 'champion' | 'baseline' {
  const params = new URLSearchParams(search);
  if (!params.has('e2e')) return 'champion';
  return params.get('npc') === 'champion' ? 'champion' : 'baseline';
}

export function createNpcClient(
  engine: Engine,
  which: 'champion' | 'baseline' = npcChoice(window.location.search),
): NpcClient {
  const local = (state: GameState): Action =>
    which === 'baseline'
      ? chooseAction(engine, state)
      : chooseNpcAction(engine, state, loadChampion());
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<
    number,
    { state: GameState; resolve: (action: Action) => void; reject: (err: unknown) => void }
  >();

  /** Stops using the worker and answers everything still waiting on the main thread. */
  const fallBack = (): void => {
    worker?.terminate();
    worker = null;
    for (const { state, resolve, reject } of pending.values()) {
      try {
        resolve(local(state));
      } catch (err) {
        reject(err);
      }
    }
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
      if ('action' in event.data) entry.resolve(event.data.action);
      else {
        // The worker's NPC threw; try once on the main thread, and let the caller fall back.
        try {
          entry.resolve(local(entry.state));
        } catch (err) {
          entry.reject(err);
        }
      }
    };
    worker.onerror = fallBack;
  } catch {
    worker = null;
  }

  return {
    chooseAction(state) {
      if (!worker) {
        try {
          return Promise.resolve(local(state));
        } catch (err) {
          return Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
      const id = nextId++;
      return new Promise<Action>((resolve, reject) => {
        pending.set(id, { state, resolve, reject });
        const request: NpcRequest = { id, state, npc: which };
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
