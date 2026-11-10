import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, IllegalActionError, type GameState } from './index.js';
import { applyUntil, editable, keepOnly, placeUnit } from './test-helpers.js';

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
    const s = engine.newGame(1);
    expect(s.active).toBe(0);
    expect(s.firstPlayer).toBe(0);
    expect(s.players.map((p) => p.cp)).toEqual([4, 4]);
    expect(engine.decision(s)).toEqual({ kind: 'main', player: 0, phase: 'hero' });
  });
});

describe('priority', () => {
  const atRound2 = toPriority(engine.newGame(2));

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
    let end = engine.newGame(3);
    while (!(end.round === 1 && end.turnIndex === 1 && end.phase === 'end')) {
      end = engine.apply(end, engine.defaultAction(end)).state;
    }
    const tied = applyUntil(engine, end, { t: 'pass' }, (r) =>
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

describe('end of turn', () => {
  it('resolves objective control and scores for the player whose turn it was', () => {
    const s0 = editable(engine.newGame(1));
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
    let s = engine.newGame(4);
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
