/**
 * The one game the app plays: the owner's Sylvaneth list (player 0, the attacker) against
 * the owner's Seraphon list (player 1) on Into the Fire. Shared by the UI and the NPC worker
 * so both build exactly the same scenario.
 */
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from './data/lists.js';
import { createEngine, createScenario } from './engine/index.js';

export const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
export const engine = createEngine(scenario);
