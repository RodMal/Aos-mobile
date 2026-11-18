/** Seraphon: The Great Plan and Further the Great Plan. */
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { Modal } from './Modal.js';

export function AsterismPrompt({ d }: { d: Extract<Decision, { kind: 'asterism' }> }) {
  const great = d.stage === 'great';
  return (
    <Modal title={great ? 'The Great Plan' : 'Further the Great Plan'} testId="asterism">
      <p>
        {great
          ? 'Pick the Asterism to prophesy for the rest of the battle.'
          : 'Pick an Asterism to prophesy. It has no effect unless its condition is met, and you cannot pick it again.'}
      </p>
      <div className="stack">
        {d.options.map((o) => (
          <button
            key={o.id}
            className="btn wide"
            data-asterism={o.id}
            data-met={o.met}
            onClick={() => dispatch({ t: 'choose', value: o.id })}
          >
            <strong>{o.name}</strong>
            <span className="muted small block">{o.text}</span>
            {!great && (
              <span className="muted small block">
                {o.met ? 'Condition met: ' : 'Condition not met: '}
                {o.condition}
              </span>
            )}
          </button>
        ))}
        {!great && (
          <button
            className="btn wide"
            data-testid="asterism-pass"
            onClick={() => dispatch({ t: 'pass' })}
          >
            Pass
          </button>
        )}
      </div>
    </Modal>
  );
}
