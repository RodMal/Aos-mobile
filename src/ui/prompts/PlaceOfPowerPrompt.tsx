/** Place of Power boon. */
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { Modal } from './Modal.js';

export function PlaceOfPowerPrompt({ d }: { d: Extract<Decision, { kind: 'placeOfPower' }> }) {
  const state = useGameState();
  const heroName = state.units[d.hero]?.name ?? 'Hero';
  return (
    <Modal title="Place of Power" testId="place-of-power">
      <p>
        <strong>{heroName}</strong> is within 3&quot; of a Place of Power at the start of the turn.
        Choose a boon for this turn (once per turn for your army), or pass.
      </p>
      <p className="muted small">
        Roll 1D6: on a 1, {heroName} suffers D3 mortal damage backfire. On a 2+, the chosen boon is
        granted.
      </p>
      <div className="stack">
        <button
          className="btn wide"
          onClick={() => dispatch({ t: 'choose', value: 'ignite_fury' })}
        >
          <strong>Ignite Fury</strong>
          <span className="muted small block">+2 Rage Dice &amp; +2 Fury Level</span>
        </button>
        <button
          className="btn wide"
          onClick={() => dispatch({ t: 'choose', value: 'channelled_wrath' })}
        >
          <strong>Channelled Wrath</strong>
          <span className="muted small block">
            +1 to this hero&apos;s casting &amp; chanting rolls this turn
          </span>
        </button>
        <button
          className="btn wide"
          onClick={() => dispatch({ t: 'choose', value: 'dizzying_rage' })}
        >
          <strong>Dizzying Rage</strong>
          <span className="muted small block">
            This hero can unbind or banish once this turn, even if it is no Wizard
          </span>
        </button>
        <button className="btn primary wide" onClick={() => dispatch({ t: 'pass' })}>
          Pass
        </button>
      </div>
    </Modal>
  );
}
