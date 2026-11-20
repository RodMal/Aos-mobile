/**
 * Hooks for e2e tests only, loaded when the URL has `e2e`: the engine, the baseline NPC and two
 * read-only queries (base-to-base distance, faction terrain). Nothing here changes a game.
 */
import { chooseAction } from '../ai/baseline.js';
import { isFactionTerrainUnit, unitDistance } from '../engine/index.js';
import { engine } from '../game.js';

declare global {
  interface Window {
    __aosTest?: {
      engine: typeof engine;
      chooseAction: typeof chooseAction;
      unitDistance: typeof unitDistance;
      isFactionTerrainUnit: typeof isFactionTerrainUnit;
    };
  }
}

window.__aosTest = { engine, chooseAction, unitDistance, isFactionTerrainUnit };
