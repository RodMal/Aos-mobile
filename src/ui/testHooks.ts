/**
 * Hooks for e2e tests only, loaded when the URL has `e2e`: the engine, the baseline NPC, two
 * read-only queries (base-to-base distance, faction terrain) and the game store (`game`), for a
 * test that sets a position up by hand (`game.setState({ session })`). Loaded only with `?e2e`;
 * `game` lets e2e tests replace the running game's state, so it must never ship in normal play.
 */
import { chooseAction } from '../ai/baseline.js';
import { isFactionTerrainUnit, unitDistance } from '../engine/index.js';
import { engine } from '../game.js';
import { useGame } from './game/instance.js';

declare global {
  interface Window {
    __aosTest?: {
      engine: typeof engine;
      chooseAction: typeof chooseAction;
      unitDistance: typeof unitDistance;
      isFactionTerrainUnit: typeof isFactionTerrainUnit;
      game: typeof useGame;
    };
  }
}

window.__aosTest = { engine, chooseAction, unitDistance, isFactionTerrainUnit, game: useGame };
