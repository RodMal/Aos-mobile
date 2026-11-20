/**
 * Game positions for e2e tests that are slow to reach by tapping: the app's own engine plays
 * both sides with the baseline NPC from a seed (in the page, through `src/ui/testHooks.ts`)
 * until a condition holds, and the test then opens the result as a saved game.
 */
import type { Page } from '@playwright/test';
import type { Action, Decision, Engine, GameState } from '../../src/engine/index.js';
import { RULES_VERSION } from '../../src/ui/game/rulesVersion.js';

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

export interface PositionOptions {
  /** The human's side when the game is opened (default 0). */
  side?: 0 | 1;
  /** Start with interactive deployment instead of the quick start. */
  deploy?: boolean;
  /** How many seeds to try from `seed` (default 20), for a position the NPC reaches rarely. */
  seeds?: number;
}

/**
 * Plays NPC actions from each seed in turn (`seed` up to `seed + 19`) until `stop` returns a
 * string (before the next action), then reloads the app on that saved game as player
 * `options.side` (default 0). `stop` runs in the page: it may only use its arguments.
 */
export async function openPosition(
  page: Page,
  seed: number,
  stop: (engine: Engine, state: GameState, d: Decision) => string | null,
  options: PositionOptions = {},
): Promise<Position> {
  const side = options.side ?? 0;
  const deploy = options.deploy === true;
  const seeds = options.seeds ?? 20;
  // The searching page always opens as player 0, who decides first, so the computer never
  // plays (and saves over the record written below) before the page is reloaded.
  await page.goto(`./?e2e=1&seed=${seed}&side=0&fast=1&new=1`);
  await page.waitForFunction(() => !!(window as unknown as Hooks).__aosTest);
  const position = await page.evaluate(
    ({ seed, stopSource, rules, side, deploy, seeds }) => {
      const { engine, chooseAction } = (window as unknown as Hooks).__aosTest!;
      const stopFn = new Function(`return (${stopSource})`)() as (
        e: Engine,
        s: GameState,
        d: Decision,
      ) => string | null;
      for (let k = seed; k < seed + seeds; k++) {
        let state = engine.newGame(k, deploy ? { deploy: true } : undefined);
        const actions: Action[] = [];
        for (let i = 0; i < 4000; i++) {
          const d = engine.decision(state);
          if (!d) break;
          const note = stopFn(engine, state, d);
          if (note !== null) {
            localStorage.setItem(
              'aos-mobile:game',
              JSON.stringify({
                v: 1,
                rules,
                seed: k,
                humanPlayer: side,
                ...(deploy ? { deploy: true } : {}),
                actions,
              }),
            );
            return { seed: k, actions, state, note };
          }
          const action = chooseAction(engine, state);
          actions.push(action);
          state = engine.apply(state, action).state;
        }
      }
      throw new Error(`seeds ${seed} to ${seed + seeds - 1}: the position was never reached`);
    },
    { seed, stopSource: stop.toString(), rules: RULES_VERSION, side, deploy, seeds },
  );
  await page.goto(`./?seed=${position.seed}&side=${side}&fast=1`);
  return position;
}
