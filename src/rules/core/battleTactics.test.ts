import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { cloneState } from '../../engine/engine.js';
import { createEngine, createScenario, unitsOf } from '../../engine/index.js';
import {
  evaluateBattleTactic,
  evaluateEndOfTurnTactics,
  initBattleTactics,
  recordTurnStartForTactics,
  BLAZING_ONSLAUGHT_ID,
  BURNING_FOR_VENGEANCE_ID,
  FLANKING_FIRESTORM_ID,
  LEGEND_OF_THE_PARCH_ID,
  SIEGE_OF_ASHES_ID,
} from './battleTactics.js';
import type { GameState, PlayerId } from '../../engine/index.js';

/** The player's army units, leaving out faction terrain. */
const armyUnits = (state: GameState, p: PlayerId) => unitsOf(state, p).filter((u) => u.armyIndex >= 0);

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

describe('Battle Tactics (GHB 2026-27)', () => {
  it('initialises tactic cards to affray and nominates fugitive and hideout', () => {
    const state = cloneState(engine.newGame(1));
    initBattleTactics(scenario, state);

    // Player 0 (Sylvaneth) has Burning for Vengeance and Flanking Firestorm
    expect(state.players[0].tacticProgress?.[FLANKING_FIRESTORM_ID]).toBe('affray');
    expect(state.players[0].tacticProgress?.[BURNING_FOR_VENGEANCE_ID]).toBe('affray');
    expect(state.players[0].fugitiveUnit).toBeDefined();

    // Player 1 (Seraphon placeholder) has Siege of Ashes and Blazing Onslaught
    expect(state.players[1].tacticProgress?.[SIEGE_OF_ASHES_ID]).toBe('affray');
    expect(state.players[1].tacticProgress?.[BLAZING_ONSLAUGHT_ID]).toBe('affray');
    expect(state.players[1].hideoutTerrain).toBeDefined();
  });

  it('records turn-start objective snapshot and turnStartInCombat', () => {
    const state = cloneState(engine.newGame(1));
    state.objectives[0]!.controller = 0;
    recordTurnStartForTactics(scenario, state);

    expect(state.turnStartObjectives?.[state.objectives[0]!.id]).toBe(0);
    expect(state.unitsDestroyedThisTurn).toEqual([]);
    expect(state.destroyedByChargeCombat).toEqual([]);
    expect(state.damagedInPhases).toEqual({});
  });

  it('evaluates Flanking Firestorm (Strike: Surround the Enemy, Domination: Claim Whats Yours)', () => {
    const state = cloneState(engine.newGame(1));
    initBattleTactics(scenario, state);

    // Move all units to neutral territory (50, 5) which is outside both territories
    for (const id of state.unitOrder) {
      const u = state.units[id]!;
      for (const m of u.models) {
        m.x = 50;
        m.y = 5;
      }
    }

    const spites = unitsOf(state, 0).find((u) => u.name === 'Spite-Revenants')!;
    const dryads = unitsOf(state, 0).find((u) => u.name === 'Dryads')!;
    const durthu = unitsOf(state, 0).find((u) => u.name === 'Spirit of Durthu')!;

    // Strike: 2+ friendly units wholly outside friendly territory and each within 9" of a different corner
    // Friendly territory for player 0 is territory B (x <= 30, y <= 33).
    // Corners (60,0) and (60,44) are outside territory B.
    spites.models.forEach((m) => {
      m.x = 56;
      m.y = 4;
    });
    dryads.models.forEach((m) => {
      m.x = 56;
      m.y = 40;
    });
    expect(evaluateBattleTactic(scenario, state, 0, FLANKING_FIRESTORM_ID, 'strike')).toBe(true);

    // Domination: more friendly units within enemy territory than enemy units, and at least 1 friendly Hero wholly within enemy territory.
    // Durthu and Spites in enemy territory A (e.g. at (40, 20))
    durthu.models[0]!.x = 40;
    durthu.models[0]!.y = 20; // Territory A
    expect(evaluateBattleTactic(scenario, state, 0, FLANKING_FIRESTORM_ID, 'domination')).toBe(
      true,
    );
  });

  it('evaluates Burning for Vengeance (Strike: Quick Pursuit, Domination: Bring Them In)', () => {
    const state = cloneState(engine.newGame(1));
    initBattleTactics(scenario, state);

    // Fugitive killed / off the board
    const fugitiveId = state.players[0].fugitiveUnit!;
    state.units[fugitiveId]!.status = 'destroyed';

    // Strike: if no fugitive on board -> true
    expect(evaluateBattleTactic(scenario, state, 0, BURNING_FOR_VENGEANCE_ID, 'strike')).toBe(true);

    // Domination: if no fugitive on board, 3+ friendly units contest the same objective wholly outside friendly territory
    const u1 = armyUnits(state, 0)[0]!;
    const u2 = armyUnits(state, 0)[1]!;
    const u3 = armyUnits(state, 0)[2]!;

    // Objective in enemy territory or centre
    const obj = scenario.battlefield.objectives[0]!;
    for (const u of [u1, u2, u3]) {
      u.models.forEach((m) => {
        m.x = obj.x;
        m.y = obj.y;
      });
    }

    expect(evaluateBattleTactic(scenario, state, 0, BURNING_FOR_VENGEANCE_ID, 'domination')).toBe(
      true,
    );
  });

  it('evaluates Siege of Ashes (Affray: Form a Wall)', () => {
    const state = cloneState(engine.newGame(1));
    initBattleTactics(scenario, state);

    // Player 1 has Siege of Ashes. Friendly territory is Territory A (x >= 30, y >= 11)
    const w1 = armyUnits(state, 1)[0]!;
    const w2 = armyUnits(state, 1)[1]!;

    // Move all units to neutral territory (50, 5)
    for (const id of state.unitOrder) {
      const u = state.units[id]!;
      for (const m of u.models) {
        m.x = 50;
        m.y = 5;
      }
    }

    // Affray: 2+ units wholly outside friendly territory, wholly within 6" of friendly territory, and within 3" of each other.
    // Territory A starts at x=30 for y between 11 and 33. Place at x=28 (2" from boundary) and within 3" of each other
    w1.models.forEach((m) => {
      m.x = 28;
      m.y = 20;
    });
    w2.models.forEach((m) => {
      m.x = 29;
      m.y = 20;
    });

    expect(evaluateBattleTactic(scenario, state, 1, SIEGE_OF_ASHES_ID, 'affray')).toBe(true);
  });

  it('evaluates Legend of the Parch (Affray: Daring Rescue)', () => {
    const state = cloneState(engine.newGame(1));
    initBattleTactics(scenario, state);

    const enemyUnitId = armyUnits(state, 0)[0]!.id;
    state.turnStartInCombat = [enemyUnitId];
    state.destroyedByChargeCombat = [enemyUnitId];

    expect(evaluateBattleTactic(scenario, state, 1, LEGEND_OF_THE_PARCH_ID, 'affray')).toBe(true);
  });

  it('seizing initiative prevents scoring battle tactics on that first turn', () => {
    const state = cloneState(engine.newGame(1));
    initBattleTactics(scenario, state);
    recordTurnStartForTactics(scenario, state);

    // Set player 0 as seized this round
    state.seizedThisRound = 0;
    state.turnIndex = 0;

    const scored = evaluateEndOfTurnTactics(scenario, state, 0);
    expect(scored).toEqual([]);
  });
});
