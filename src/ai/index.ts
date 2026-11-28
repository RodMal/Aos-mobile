/**
 * The NPC's entry point. The app and the scripts call `chooseNpcAction` with a config; the
 * shipped config is the champion. With no feature switched on (version 0) it is the baseline.
 */
import type { Action, Engine, GameState } from '../engine/index.js';
import { chooseAction } from './baseline.js';
import championJson from './params/champion.json';
import { NpcConfigSchema, type NpcConfig } from './params/schema.js';

export { NpcConfigSchema, type NpcConfig } from './params/schema.js';

let champion: NpcConfig | undefined;

/** The shipped NPC configuration (validated once). */
export function loadChampion(): NpcConfig {
  champion ??= NpcConfigSchema.parse(championJson);
  return champion;
}

export function chooseNpcAction(engine: Engine, state: GameState, config: NpcConfig): Action {
  // No feature has an implementation yet (M5c and later add them), so every config plays the
  // baseline until one is switched on in `config.features`.
  void config;
  return chooseAction(engine, state);
}
