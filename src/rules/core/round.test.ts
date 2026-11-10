import { describe, expect, it } from 'vitest';
import type { GameState } from '../../engine/types.js';
import { priorityWinner, roundCommandPoints, seizes, underdog } from './round.js';

function state(vp: [number, number], seizedBy: 0 | 1 | null = null): GameState {
  return {
    players: [
      { cp: 0, vp: vp[0], vpByRound: [] },
      { cp: 0, vp: vp[1], vpByRound: [] },
    ],
    seizedBy,
  } as unknown as GameState;
}

describe('priority roll', () => {
  it('goes to the higher roll', () => {
    expect(priorityWinner([5, 2], 1)).toBe(0);
    expect(priorityWinner([1, 4], 0)).toBe(1);
  });

  it('a tie goes to the player who went first in the previous round', () => {
    expect(priorityWinner([3, 3], 1)).toBe(1);
    expect(priorityWinner([6, 6], 0)).toBe(0);
  });
});

describe('seizing the initiative', () => {
  it('the winner who went second last round and now goes first seizes', () => {
    expect(seizes(state([10, 10]), 1, 0, 1)).toBe(true);
  });

  it('is not a seize to go first again, to hand the first turn over, or for the roll loser', () => {
    expect(seizes(state([10, 10]), 0, 0, 0)).toBe(false);
    expect(seizes(state([10, 10]), 0, 0, 1)).toBe(false);
  });

  it('is not a seize when the opponent leads by 11 VP or more', () => {
    expect(seizes(state([21, 10]), 1, 0, 1)).toBe(false);
    expect(seizes(state([20, 10]), 1, 0, 1)).toBe(true);
  });
});

describe('underdog and command points', () => {
  it('nobody is the underdog when tied; otherwise the player with fewer VP', () => {
    expect(underdog(state([5, 5]))).toBeNull();
    expect(underdog(state([3, 8]))).toBe(0);
  });

  it("the seizer's opponent is the underdog whatever the score", () => {
    expect(underdog(state([3, 8], 0))).toBe(1);
  });

  it('each player gets 4 CP and the underdog 1 more', () => {
    const s = state([3, 8]);
    expect(roundCommandPoints(s, 0)).toBe(5);
    expect(roundCommandPoints(s, 1)).toBe(4);
    expect(roundCommandPoints(state([0, 0]), 0)).toBe(4);
  });
});
