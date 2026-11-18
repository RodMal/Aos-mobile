/** A chanting roll that answers the prayer: use it now, or bank the ritual points. */
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { Modal } from './Modal.js';

export function PrayerPrompt({ d }: { d: Extract<Decision, { kind: 'prayer' }> }) {
  const state = useGameState();
  const unit = state.units[d.unit]?.name ?? 'The Priest';
  return (
    <Modal title="Prayer answered" testId="prayer">
      <p>
        {unit} chants {d.ability}: a roll of <strong>{d.die}</strong>
        {d.banked > 0 ? ` and ${d.banked} banked` : ''} makes <strong>{d.points}</strong> ritual
        points, enough for the chanting value of {d.targetValue}. Use the prayer now, or keep the
        points for a later chant.
      </p>
      <div className="stack">
        <button
          className="btn primary wide"
          data-testid="prayer-use"
          onClick={() => dispatch({ t: 'choose', value: 'use' })}
        >
          Use the prayer now
        </button>
        <button
          className="btn wide"
          data-testid="prayer-bank"
          onClick={() => dispatch({ t: 'choose', value: 'bank' })}
        >
          Bank {d.points} ritual points
        </button>
      </div>
    </Modal>
  );
}
