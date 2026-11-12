import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { engine } from '../../game.js';
import type { GameEvent } from '../../engine/index.js';
import { turnScores } from './turnScores.js';

describe('turn scoring breakdown', () => {
  it('groups score events by turn with turn totals and running totals', () => {
    const events: GameEvent[] = [
      { t: 'turnStart', player: 0, round: 1 },
      { t: 'score', player: 0, vp: 3, reason: 'Controlled at least 1 objective (1 held)' },
      {
        t: 'score',
        player: 0,
        vp: 4,
        reason: 'Controlled more objectives than the opponent (1 to 0)',
      },
      { t: 'turnStart', player: 1, round: 1 },
      { t: 'score', player: 1, vp: 5, reason: 'Flanking Firestorm — Affray' },
      { t: 'gameEnd', winner: 0, vp: [7, 5] },
    ];
    expect(turnScores(events)).toEqual([
      {
        round: 1,
        player: 0,
        lines: [
          { player: 0, vp: 3, reason: 'Controlled at least 1 objective (1 held)' },
          { player: 0, vp: 4, reason: 'Controlled more objectives than the opponent (1 to 0)' },
        ],
        turnTotal: [7, 0],
        running: [7, 0],
      },
      {
        round: 1,
        player: 1,
        lines: [{ player: 1, vp: 5, reason: 'Flanking Firestorm — Affray' }],
        turnTotal: [0, 5],
        running: [7, 5],
      },
    ]);
  });

  it('in a whole game, every VP is on a line and the running totals end at the final score', () => {
    let s = engine.newGame(3);
    const events: GameEvent[] = [{ t: 'turnStart', player: s.active, round: 1 }];
    while (engine.decision(s)) {
      const r = engine.apply(s, chooseAction(engine, s));
      events.push(...r.events);
      s = r.state;
    }
    const turns = turnScores(events);
    expect(turns).toHaveLength(10);
    const last = turns[turns.length - 1]!;
    expect(last.running).toEqual([s.players[0].vp, s.players[1].vp]);
    for (const t of turns) {
      for (const l of t.lines) {
        expect(l.reason.length).toBeGreaterThan(5);
        expect(l.vp).toBeGreaterThan(0);
      }
    }
  });
});
