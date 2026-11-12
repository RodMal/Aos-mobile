import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, IllegalActionError, type GameState } from './index.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from './test-helpers.js';
import {
  BURNING_FOR_VENGEANCE_ID,
  FLANKING_FIRESTORM_ID,
  enemyTerritories,
  evaluateEndOfTurnTactics,
} from '../rules/core/battleTactics.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

/** Passes every decision with the default action until the given round's priority choice. */
function toPriority(state: GameState): GameState {
  let s = state;
  while (engine.decision(s)?.kind !== 'priority')
    s = engine.apply(s, engine.defaultAction(s)).state;
  return s;
}

describe('battle round 1', () => {
  it('player 0 takes the first turn and each player has 4 CP', () => {
    const s = startGame(engine, 1);
    expect(s.active).toBe(0);
    expect(s.firstPlayer).toBe(0);
    expect(s.players.map((p) => p.cp)).toEqual([4, 4]);
    expect(engine.decision(s)).toEqual({ kind: 'main', player: 0, phase: 'hero' });
  });

  /** Answers the pre-battle picks before the first-turn choice with the default. */
  function toFirstTurnChoice(s0: GameState, eng = engine): GameState {
    let s = s0;
    while (eng.decision(s)?.kind !== 'priority') s = eng.apply(s, eng.defaultAction(s)).state;
    return s;
  }

  it('quick start: the attacker chooses who takes the first turn (owner, 2026-11-11)', () => {
    const s = toFirstTurnChoice(engine.newGame(1));
    expect(engine.decision(s)).toEqual({
      kind: 'priority',
      player: 0,
      rolls: [0, 0],
      reason: 'deployment',
    });
    const second = engine.apply(s, { t: 'choose', value: 'second' }).state;
    expect(second.firstPlayer).toBe(1);
    expect(second.active).toBe(1);
    expect(second.seizedThisRound ?? null).toBeNull();
    // Player 1 as the attacker: they choose, and they start on the attacker's fury.
    const flipped = createEngine(
      createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER], { attacker: 1 }),
    );
    const f = toFirstTurnChoice(flipped.newGame(1), flipped);
    expect(flipped.decision(f)).toMatchObject({ kind: 'priority', player: 1 });
    expect(f.players.map((p) => p.furyLevel)).toEqual([2, 1]);
  });

  it('alternating deployment: the player who finished deploying first chooses', () => {
    let s = engine.newGame(1, { deploy: true });
    while (engine.decision(s)?.kind === 'place') s = engine.apply(s, engine.defaultAction(s)).state;
    s = toFirstTurnChoice(s);
    expect(s.deploymentFinishedFirst).toBeDefined();
    expect(engine.decision(s)).toMatchObject({
      kind: 'priority',
      player: s.deploymentFinishedFirst,
      reason: 'deployment',
    });
  });
});

describe('priority', () => {
  const atRound2 = toPriority(startGame(engine, 2));

  it('from round 2 both players roll and the winner chooses', () => {
    expect(atRound2.round).toBe(2);
    const d = engine.decision(atRound2);
    if (d?.kind !== 'priority') throw new Error('expected a priority decision');
    const [a, b] = d.rolls;
    if (a !== b) expect(d.player).toBe(a > b ? 0 : 1);
    else expect(d.player).toBe(0); // the tie goes to the player who went first in round 1
    expect(engine.defaultAction(atRound2)).toEqual({ t: 'choose', value: 'first' });
  });

  it('choosing "second" gives the first turn to the opponent', () => {
    const d = engine.decision(atRound2)!;
    const s = engine.apply(atRound2, { t: 'choose', value: 'second' }).state;
    expect(s.active).toBe(d.player === 0 ? 1 : 0);
    expect(s.firstPlayer).toBe(s.active);
    expect(s.phase).toBe('hero');
  });

  it('refuses anything but "first" or "second"', () => {
    expect(() => engine.apply(atRound2, { t: 'choose', value: 'both' })).toThrow(
      IllegalActionError,
    );
    expect(() => engine.apply(atRound2, { t: 'pass' })).toThrow(IllegalActionError);
  });

  it('a tie goes to the player who took the first turn of the previous round', () => {
    // Round 1's first player was 0; find dice that tie by trying RNG states from round 1's end.
    let end = startGame(engine, 3);
    while (!(end.round === 1 && end.turnIndex === 1 && end.phase === 'end')) {
      end = engine.apply(end, engine.defaultAction(end)).state;
    }
    // Seasons Of War is chosen at the start of the round, before the priority roll.
    const next = engine.apply(end, { t: 'pass' }).state;
    const [from, action] =
      engine.decision(next)?.kind === 'alarielleSeason'
        ? [next, engine.defaultAction(next)]
        : [end, { t: 'pass' as const }];
    const tied = applyUntil(engine, from, action, (r) =>
      r.events.some((e) => e.t === 'priority' && e.rolls[0] === e.rolls[1]),
    );
    expect(engine.decision(tied.state)).toMatchObject({ kind: 'priority', player: 0 });
  });

  it('the underdog (fewer VP) gets 1 extra CP', () => {
    const s = editable(atRound2);
    s.players[0].vp = 3;
    s.players[1].vp = 10;
    const after = engine.apply(s, { t: 'choose', value: 'first' }).state;
    expect(after.players.map((p) => p.cp)).toEqual([5, 4]);
  });

  it('going second last round and taking the first turn seizes the initiative', () => {
    const s = editable(atRound2);
    const d = engine.decision(s)!;
    s.firstPlayer = d.player === 0 ? 1 : 0; // the winner went second last round
    const after = engine.apply(s, { t: 'choose', value: 'first' });
    expect(after.state.seizedBy).toBe(d.player);
    // Their opponent is now the underdog.
    expect(after.state.players[d.player === 0 ? 1 : 0].cp).toBe(5);
  });
});

describe('battle tactics scoring (owner ruling, 2026-11-11)', () => {
  const atRound2 = toPriority(startGame(engine, 2));

  /** Player 0's state with both cards at a tier that is complete right now. */
  function bothCardsReady(s: GameState): void {
    const fugitive = s.players[0].fugitiveUnit!;
    const hero = Object.values(s.units).find(
      (u) => u.owner === 0 && u.armyIndex >= 0 && u.name.startsWith('Alarielle'),
    )!;
    keepOnly(s, [hero.id]);
    s.units[fugitive]!.status = 'destroyed';
    // Flanking Firestorm Domination: more friendly units in enemy territory than enemy units
    // and a friendly Hero wholly within it. Burning for Vengeance Strike: no fugitive left.
    const enemy = enemyTerritories(scenario, 0)[0]!;
    const cx = enemy.reduce((a, p) => a + p[0], 0) / enemy.length;
    const cy = enemy.reduce((a, p) => a + p[1], 0) / enemy.length;
    placeUnit(scenario, s, hero.id, cx, cy);
    s.players[0].tacticProgress = {
      [FLANKING_FIRESTORM_ID]: 'domination',
      [BURNING_FOR_VENGEANCE_ID]: 'strike',
    };
  }

  it('both cards advance in the same turn, 5 VP per tier', () => {
    const s = editable(startGame(engine, 1));
    bothCardsReady(s);
    const scored = evaluateEndOfTurnTactics(scenario, s, 0);
    expect(scored.map((t) => t.cardId).sort()).toEqual(
      [BURNING_FOR_VENGEANCE_ID, FLANKING_FIRESTORM_ID].sort(),
    );
    expect(scored.every((t) => t.vp === 5)).toBe(true);
  });

  it('no tactics on the first turn of a double turn the player chose', () => {
    const s = editable(atRound2);
    const d = engine.decision(s)!;
    if (d.kind !== 'priority') throw new Error('expected priority');
    s.stack[s.stack.length - 1] = { t: 'priority', winner: 0, rolls: [6, 1] };
    s.firstPlayer = 1; // player 0 went second last round
    s.players[0].vp = 10;
    s.players[1].vp = 20; // behind by 10: still a seize
    const after = editable(engine.apply(s, { t: 'choose', value: 'first' }).state);
    expect(after.seizedThisRound).toBe(0);
    bothCardsReady(after);
    expect(evaluateEndOfTurnTactics(scenario, after, 0)).toEqual([]);
  });

  it('a player behind by 11 or more VP may score tactics on a double turn', () => {
    const s = editable(atRound2);
    s.stack[s.stack.length - 1] = { t: 'priority', winner: 0, rolls: [6, 1] };
    s.firstPlayer = 1;
    s.players[0].vp = 9;
    s.players[1].vp = 20; // behind by 11
    const after = editable(engine.apply(s, { t: 'choose', value: 'first' }).state);
    expect(after.seizedThisRound ?? null).toBeNull();
    bothCardsReady(after);
    expect(evaluateEndOfTurnTactics(scenario, after, 0)).toHaveLength(2);
  });
});

describe('end of turn', () => {
  it('resolves objective control and scores for the player whose turn it was', () => {
    const s0 = editable(startGame(engine, 1));
    keepOnly(s0, ['0:6', '1:7']);
    const obj = scenario.battlefield.objectives.find((o) => o.id === 'golden-lions-1')!;
    placeUnit(scenario, s0, '0:6', obj.x, obj.y);
    placeUnit(scenario, s0, '1:7', 55, 40);
    let s = s0;
    const events = [];
    while (s.turnIndex === 0) {
      const r = engine.apply(s, { t: 'pass' });
      events.push(...r.events);
      s = r.state;
    }
    expect(events).toContainEqual({ t: 'objective', objective: obj.id, controller: 0 });
    expect(events.filter((e) => e.t === 'score').map((e) => e.t === 'score' && e.vp)).toEqual([
      3, 4,
    ]);
    expect(s.players[0].vp).toBe(7);
    expect(s.players[0].vpByRound).toEqual([7]);
    expect(s.objectives.find((o) => o.id === obj.id)!.controller).toBe(0);
  });
});

describe('game end', () => {
  it('ends after round 5 and the higher VP total wins', () => {
    let s = startGame(engine, 4);
    let last = null;
    while (engine.decision(s)) {
      const r = engine.apply(s, engine.defaultAction(s));
      s = r.state;
      last = r.events;
    }
    expect(s.round).toBe(5);
    expect(s.status).toBe('ended');
    const [a, b] = [s.players[0].vp, s.players[1].vp];
    expect(s.winner).toBe(a === b ? 'draw' : a > b ? 0 : 1);
    expect(last).toContainEqual({ t: 'gameEnd', winner: s.winner, vp: [a, b] });
    expect(() => engine.defaultAction(s)).toThrow(IllegalActionError);
  });
});
