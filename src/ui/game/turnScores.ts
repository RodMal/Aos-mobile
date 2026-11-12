/**
 * What each turn scored and why, from the engine's `score` events: one summary per finished
 * turn with its lines, the turn's total per player and the running totals after it. Pure.
 */
import type { GameEvent, PlayerId } from '../../engine/index.js';

export interface ScoreLineView {
  player: PlayerId;
  vp: number;
  reason: string;
}

export interface TurnScore {
  round: number;
  /** Whose turn it was. */
  player: PlayerId;
  lines: ScoreLineView[];
  /** VP scored in this turn, per player. */
  turnTotal: [number, number];
  /** VP after this turn, per player. */
  running: [number, number];
}

/** Finished turns in order, from a stream of events (setup events first, then each action's). */
export function turnScores(events: Iterable<GameEvent>): TurnScore[] {
  const out: TurnScore[] = [];
  const running: [number, number] = [0, 0];
  let current: TurnScore | null = null;
  const close = () => {
    if (!current) return;
    current.running = [running[0], running[1]];
    out.push(current);
    current = null;
  };
  for (const e of events) {
    if (e.t === 'turnStart') {
      // The session's set-up events announce the first turn before the pre-battle choices,
      // and the engine announces it again once they are made.
      const c = current as TurnScore | null;
      if (c && c.round === e.round && c.player === e.player && c.lines.length === 0) continue;
      close();
      current = { round: e.round, player: e.player, lines: [], turnTotal: [0, 0], running: [0, 0] };
    } else if (e.t === 'score') {
      running[e.player] += e.vp;
      if (current) {
        current.lines.push({ player: e.player, vp: e.vp, reason: e.reason });
        current.turnTotal[e.player] += e.vp;
      }
    } else if (e.t === 'gameEnd') {
      close();
    }
  }
  return out;
}

/** All events of a session, oldest first. */
export function* sessionEvents(session: {
  startEvents: readonly GameEvent[];
  history: readonly { events: readonly GameEvent[] }[];
}): Generator<GameEvent> {
  yield* session.startEvents;
  for (const h of session.history) yield* h.events;
}
