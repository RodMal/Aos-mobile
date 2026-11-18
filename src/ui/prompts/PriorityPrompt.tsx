/** Priority roll and first-turn choice. */
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { playerName } from '../game/engine.js';
import { useGameState, useHuman } from '../game/hooks.js';
import { Modal, Die } from './Modal.js';

export function PriorityPrompt({ d }: { d: Extract<Decision, { kind: 'priority' }> }) {
  const state = useGameState();
  const human = useHuman();
  return (
    <Modal title={d.reason ? 'First turn' : 'Priority roll'} testId="priority">
      {d.reason ? (
        <p data-testid="first-turn-reason">
          {state.deploymentFinishedFirst === human
            ? 'You finished deploying first.'
            : 'You are the attacker.'}
        </p>
      ) : (
        <div className="dice-pair">
          <div>
            <Die value={d.rolls[0]} />
            <span className="muted small">{playerName(0)}</span>
          </div>
          <div>
            <Die value={d.rolls[1]} />
            <span className="muted small">{playerName(1)}</span>
          </div>
        </div>
      )}
      <p>You choose who takes the first turn of round {state.round}.</p>
      <div className="stack">
        <button
          className="btn primary wide"
          onClick={() => dispatch({ t: 'choose', value: 'first' })}
        >
          Take first turn
        </button>
        <button className="btn wide" onClick={() => dispatch({ t: 'choose', value: 'second' })}>
          Take second turn
        </button>
      </div>
    </Modal>
  );
}
