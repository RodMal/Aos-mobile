/**
 * Self-play: two NPC configurations play one seeded game against each other. Pure: the clock is
 * injected (`opts.now`), so a run without one measures nothing and is fully deterministic.
 * `npcs[i]` plays player `i`; callers swap sides by swapping the array and the results.
 */
import type { Engine, GameState, PlayerId } from '../engine/index.js';
import { startGame } from '../engine/test-helpers.js';
import { chooseAction } from './baseline.js';
import { chooseNpcAction, type NpcConfig } from './index.js';

/** `'baseline'` is the plain baseline; a config is played through `chooseNpcAction`. */
export type NpcSpec = 'baseline' | NpcConfig;

export interface MatchOptions {
  /** Milliseconds, monotonic (for example `performance.now`). Absent: no timings are recorded. */
  now?: () => number;
  /** Stop after this many actions (default 20 000); the result is then a draw with `truncated`. */
  maxSteps?: number;
}

export interface SideStats {
  vp: number;
  decisions: number;
  /** Search steps spent; no search exists yet (M5d), so 0. */
  searchSteps: number;
  /** Milliseconds spent on each decision (empty without `opts.now`). */
  decisionMs: number[];
  /** Milliseconds this side spent in each game turn (round and turn index), in turn order. */
  turnMs: number[];
}

export interface MatchResult {
  winner: PlayerId | 'draw';
  truncated: boolean;
  sides: [SideStats, SideStats];
  steps: number;
  finalState: GameState;
}

const emptySide = (): SideStats => ({
  vp: 0,
  decisions: 0,
  searchSteps: 0,
  decisionMs: [],
  turnMs: [],
});

export function playMatch(
  engine: Engine,
  seed: number,
  npcs: readonly [NpcSpec, NpcSpec],
  opts: MatchOptions = {},
): MatchResult {
  const { now, maxSteps = 20_000 } = opts;
  const sides: [SideStats, SideStats] = [emptySide(), emptySide()];
  const lastTurn: [string, string] = ['', ''];
  let state = startGame(engine, seed);
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const d = engine.decision(state);
    if (!d) break;
    const side = sides[d.player];
    const npc = npcs[d.player];
    const t0 = now?.() ?? 0;
    const action =
      npc === 'baseline' ? chooseAction(engine, state) : chooseNpcAction(engine, state, npc);
    if (now) {
      const ms = now() - t0;
      side.decisionMs.push(ms);
      const key = `${state.round}:${state.turnIndex}`;
      if (key !== lastTurn[d.player]) {
        lastTurn[d.player] = key;
        side.turnMs.push(0);
      }
      side.turnMs[side.turnMs.length - 1]! += ms;
    }
    side.decisions++;
    state = engine.apply(state, action).state;
  }
  sides[0].vp = state.players[0].vp;
  sides[1].vp = state.players[1].vp;
  return {
    winner: state.winner ?? 'draw',
    truncated: state.winner === null,
    sides,
    steps,
    finalState: state,
  };
}
