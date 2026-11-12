/** Hooks for e2e tests only, loaded when the URL has `e2e`: the engine and the baseline NPC. */
import { chooseAction } from '../ai/baseline.js';
import { engine } from '../game.js';

declare global {
  interface Window {
    __aosTest?: { engine: typeof engine; chooseAction: typeof chooseAction };
  }
}

window.__aosTest = { engine, chooseAction };
