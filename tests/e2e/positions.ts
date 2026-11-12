/**
 * Game positions for e2e tests that are slow to reach by tapping: the app's own engine plays
 * both sides with the baseline NPC from a seed (in the page, through `src/ui/testHooks.ts`)
 * until a condition holds, and the test then opens the result as a saved game.
 */
import type { Page } from '@playwright/test';
import type { Action, Decision, Engine, GameState } from '../../src/engine/index.js';

interface Hooks {
  __aosTest?: {
    engine: Engine;
    chooseAction: (engine: Engine, state: GameState) => Action;
  };
}

export interface Position {
  seed: number;
  actions: Action[];
  state: GameState;
  /** Whatever the condition chose to remember (e.g. a unit ID). */
  note: string;
}

/**
 * Plays NPC actions from each seed in turn (`seed` up to `seed + 19`) until `stop` returns a
 * string (before the next action), then reloads the app on that saved game as player 0. `stop` runs in the page: it may only use its
 * arguments.
 */
export async function openPosition(
  page: Page,
  seed: number,
  stop: (engine: Engine, state: GameState, d: Decision) => string | null,
): Promise<Position> {
  await page.goto(`./?e2e=1&seed=${seed}&side=0&fast=1&new=1`);
  await page.waitForFunction(() => !!(window as unknown as Hooks).__aosTest);
  const position = await page.evaluate(
    ({ seed, stopSource }) => {
      const { engine, chooseAction } = (window as unknown as Hooks).__aosTest!;
      const stopFn = new Function(`return (${stopSource})`)() as (
        e: Engine,
        s: GameState,
        d: Decision,
      ) => string | null;
      for (let k = seed; k < seed + 20; k++) {
        let state = engine.newGame(k);
        const actions: Action[] = [];
        for (let i = 0; i < 4000; i++) {
          const d = engine.decision(state);
          if (!d) break;
          const note = stopFn(engine, state, d);
          if (note !== null) {
            localStorage.setItem(
              'aos-mobile:game',
              JSON.stringify({ v: 1, seed: k, humanPlayer: 0, actions }),
            );
            return { seed: k, actions, state, note };
          }
          const action = chooseAction(engine, state);
          actions.push(action);
          state = engine.apply(state, action).state;
        }
      }
      throw new Error(`seeds ${seed} to ${seed + 19}: the position was never reached`);
    },
    { seed, stopSource: stop.toString() },
  );
  await page.goto(`./?seed=${position.seed}&side=0&fast=1`);
  return position;
}
