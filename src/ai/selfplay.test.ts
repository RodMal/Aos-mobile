import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario } from '../engine/index.js';
import { startGame } from '../engine/test-helpers.js';
import { chooseAction } from './baseline.js';
import { playMatch } from './selfplay.js';

const engine = createEngine(
  createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]),
);

describe('playMatch', () => {
  it('baseline vs baseline on seed 1 is the game game-hashes plays', () => {
    let state = startGame(engine, 1);
    let steps = 0;
    while (engine.decision(state)) {
      state = engine.apply(state, chooseAction(engine, state)).state;
      steps++;
    }
    const r = playMatch(engine, 1, ['baseline', 'baseline']);
    expect(JSON.stringify(r.finalState)).toBe(JSON.stringify(state));
    expect(r.steps).toBe(steps);
    expect(r.truncated).toBe(false);
    expect([r.sides[0].vp, r.sides[1].vp]).toEqual([state.players[0].vp, state.players[1].vp]);
    expect(r.sides[0].decisions + r.sides[1].decisions).toBe(steps);
  });

  it('records timings only with a clock, and repeats exactly', () => {
    let t = 0;
    const timed = playMatch(engine, 2, ['baseline', 'baseline'], { now: () => (t += 1) });
    const plain = playMatch(engine, 2, ['baseline', 'baseline']);
    expect(plain.sides[0].decisionMs).toEqual([]);
    expect(timed.sides[0].decisionMs.length).toBe(timed.sides[0].decisions);
    expect(timed.sides[0].turnMs.length).toBeGreaterThan(0);
    expect(timed.winner).toBe(plain.winner);
    expect(JSON.stringify(timed.finalState)).toBe(JSON.stringify(plain.finalState));
  });
});
