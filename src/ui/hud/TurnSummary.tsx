/**
 * The end-of-turn scoring summary: what each side scored that turn and why, the turn's total
 * and the running totals. It pops up (without a scrim, so the opponent keeps playing) when a
 * turn ends and is dismissed with one tap; past turns are listed in the battle log.
 */
import { useMemo, useState } from 'react';
import type { PlayerId } from '../../engine/index.js';
import { playerName } from '../game/engine.js';
import { useHuman } from '../game/hooks.js';
import { useGame } from '../game/instance.js';
import { sessionEvents, turnScores, type TurnScore } from '../game/turnScores.js';

/** The finished turns of the current game, oldest first. */
export function useTurnScores(): TurnScore[] {
  const session = useGame((s) => s.session);
  return useMemo(() => turnScores(sessionEvents(session)), [session]);
}

/** One turn's breakdown, used by the pop-up and by the log's "Scores by turn". */
export function TurnScoreView({ turn, human }: { turn: TurnScore; human: PlayerId }) {
  const name = (p: PlayerId) => (p === human ? 'You' : playerName(p));
  const side = (p: PlayerId) => (p === human ? 'friendly' : 'enemy');
  return (
    <div className="turn-score">
      {turn.lines.length === 0 ? (
        <p className="muted small">No VP scored this turn.</p>
      ) : (
        <ul className="turn-score-lines">
          {turn.lines.map((l, i) => (
            <li key={i} className={side(l.player)}>
              <span className="turn-score-reason">
                {turn.lines.some((x) => x.player !== l.player) && <b>{name(l.player)}: </b>}
                {l.reason}
              </span>
              <span className="turn-score-vp">+{l.vp}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="turn-score-total">
        This turn: {([0, 1] as const).map((p) => `${name(p)} +${turn.turnTotal[p]}`).join(' · ')}
      </p>
      <p className="turn-score-running">
        Total:{' '}
        {([0, 1] as const).map((p) => (
          <span key={p} className={side(p)}>
            {name(p)} {turn.running[p]}
            {p === 0 ? ' – ' : ''}
          </span>
        ))}
      </p>
    </div>
  );
}

export function turnTitle(turn: TurnScore, human: PlayerId): string {
  return `Round ${turn.round} · ${turn.player === human ? 'your' : `${playerName(turn.player)}`} turn`;
}

/** Shows the latest finished turn once; `?fast=1` (tests) hides it unless `summary=1`. */
export function TurnSummary() {
  const turns = useTurnScores();
  const human = useHuman();
  const fast = useGame((s) => s.fast);
  const enabled = !fast || new URLSearchParams(window.location.search).get('summary') === '1';
  // Turns finished before this screen opened (a resumed game) are not shown again.
  const [seen, setSeen] = useState(turns.length);
  const latest = turns[turns.length - 1];
  if (!enabled || !latest || turns.length <= seen) return null;
  return (
    <section
      className="turn-summary"
      role="dialog"
      aria-label="Turn summary"
      data-testid="turn-summary"
    >
      <header>
        <h2>{turnTitle(latest, human)} scored</h2>
      </header>
      <TurnScoreView turn={latest} human={human} />
      <button
        className="btn primary wide"
        data-testid="turn-summary-close"
        onClick={() => setSeen(turns.length)}
      >
        OK
      </button>
    </section>
  );
}
