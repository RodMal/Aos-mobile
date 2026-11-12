import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { cloneState } from '../../engine/engine.js';
import { IllegalActionError, createEngine, createScenario, unitsOf } from '../../engine/index.js';
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
import { editable, keepOnly, placeUnit, startGame } from '../../engine/test-helpers.js';

/** The player's army units, leaving out faction terrain. */
const armyUnits = (state: GameState, p: PlayerId) =>
  unitsOf(state, p).filter((u) => u.armyIndex >= 0);

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

describe('Battle Tactics (GHB 2026-27)', () => {
  it('initialises tactic cards to affray and nominates fugitive and hideout', () => {
    const state = cloneState(startGame(engine, 1));
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
    const state = cloneState(startGame(engine, 1));
    state.objectives[0]!.controller = 0;
    recordTurnStartForTactics(scenario, state);

    expect(state.turnStartObjectives?.[state.objectives[0]!.id]).toBe(0);
    expect(state.unitsDestroyedThisTurn).toEqual([]);
    expect(state.destroyedByChargeCombat).toEqual([]);
    expect(state.damagedInPhases).toEqual({});
  });

  it('evaluates Flanking Firestorm (Strike: Surround the Enemy, Domination: Claim Whats Yours)', () => {
    const state = cloneState(startGame(engine, 1));
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
    const state = cloneState(startGame(engine, 1));
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
    const state = cloneState(startGame(engine, 1));
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
    const state = cloneState(startGame(engine, 1));
    initBattleTactics(scenario, state);

    const enemyUnitId = armyUnits(state, 0)[0]!.id;
    state.turnStartInCombat = [enemyUnitId];
    state.destroyedByChargeCombat = [enemyUnitId];

    expect(evaluateBattleTactic(scenario, state, 1, LEGEND_OF_THE_PARCH_ID, 'affray')).toBe(true);
  });

  it('seizing initiative prevents scoring battle tactics on that first turn', () => {
    const state = cloneState(startGame(engine, 1));
    initBattleTactics(scenario, state);
    recordTurnStartForTactics(scenario, state);

    // Set player 0 as seized this round
    state.seizedThisRound = 0;
    state.turnIndex = 0;

    const scored = evaluateEndOfTurnTactics(scenario, state, 0);
    expect(scored).toEqual([]);
  });

  describe('Burning for Vengeance fugitive (picked by the player)', () => {
    it('asks the player with the card to pick an enemy Hero before the first turn', () => {
      const s0 = engine.newGame(1);
      const d = engine.decision(s0)!;
      expect(d.kind).toBe('fugitive');
      if (d.kind !== 'fugitive') return;
      expect(d.player).toBe(0);
      expect(s0.players[0].fugitiveUnit ?? null).toBeNull();
      expect(d.units.length).toBeGreaterThan(0);
      for (const id of d.units) expect(s0.units[id]!.owner).toBe(1);
      // A friendly unit or a non-Hero is refused.
      const friendly = armyUnits(s0, 0)[0]!.id;
      expect(() => engine.apply(s0, { t: 'choose', value: friendly })).toThrow(IllegalActionError);
      const nonHero = armyUnits(s0, 1).find((u) => !d.units.includes(u.id))!.id;
      expect(() => engine.apply(s0, { t: 'choose', value: nonHero })).toThrow(IllegalActionError);
      const pick = d.units[d.units.length - 1]!;
      let s1 = engine.apply(s0, { t: 'choose', value: pick }).state;
      expect(s1.players[0].fugitiveUnit).toBe(pick);
      // The first-turn choice and the optional Place of Power offers come next.
      expect(engine.decision(s1)).toMatchObject({ kind: 'priority', reason: 'deployment' });
      while (engine.decision(s1)?.kind !== 'main')
        s1 = engine.apply(s1, engine.defaultAction(s1)).state;
      expect(engine.decision(s1)).toMatchObject({ kind: 'main', phase: 'hero', player: 0 });
      // The default (and the NPC) picks one of the legal Heroes.
      expect(d.units).toContain((engine.defaultAction(s0) as { value: string }).value);
    });

    it('lets Quick Pursuit and then Bring Them In complete against the picked fugitive', () => {
      const s0 = engine.newGame(1);
      const d = engine.decision(s0)!;
      if (d.kind !== 'fugitive') throw new Error('expected a fugitive pick');
      const fugitive = d.units[0]!;
      const state = editable(engine.apply(s0, { t: 'choose', value: fugitive }).state);
      const hunters = armyUnits(state, 0)
        .filter((u) => u.models.length === 1)
        .slice(0, 3)
        .map((u) => u.id);
      expect(hunters).toHaveLength(3);
      keepOnly(state, [fugitive, ...hunters]);
      state.players[0].tacticProgress![BURNING_FOR_VENGEANCE_ID] = 'strike';
      placeUnit(scenario, state, fugitive, 30, 22);
      // Strike: three friendly units within 12" of the fugitive and not in combat.
      placeUnit(scenario, state, hunters[0]!, 20, 22);
      placeUnit(scenario, state, hunters[1]!, 40, 22);
      placeUnit(scenario, state, hunters[2]!, 30, 13);
      let scored = evaluateEndOfTurnTactics(scenario, state, 0);
      expect(scored.map((t) => t.tier)).toContain('strike');
      expect(state.players[0].tacticProgress![BURNING_FOR_VENGEANCE_ID]).toBe('domination');
      // Domination: three friendly units in combat with the fugitive.
      placeUnit(scenario, state, hunters[0]!, 25, 22);
      placeUnit(scenario, state, hunters[1]!, 35, 22);
      placeUnit(scenario, state, hunters[2]!, 30, 17);
      scored = evaluateEndOfTurnTactics(scenario, state, 0);
      expect(scored.map((t) => t.tier)).toContain('domination');
      expect(state.players[0].tacticProgress![BURNING_FOR_VENGEANCE_ID]).toBe('completed');
    });
  });
});
