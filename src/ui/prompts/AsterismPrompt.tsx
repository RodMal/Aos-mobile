/** Seraphon: The Great Plan and Further the Great Plan. */
import { useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { Modal } from './Modal.js';

/**
 * The Great Plan: one tap on the Asterism to prophesy. Further the Great Plan: first the key (a
 * prophesied Asterism not used as a key before; one whose condition is not met is disabled),
 * then the Asterism to prophesy, or pass.
 */
export function AsterismPrompt({ d }: { d: Extract<Decision, { kind: 'asterism' }> }) {
  const great = d.stage === 'great';
  const [key, setKey] = useState<string | null>(null);
  const keyName = d.keys.find((k) => k.id === key)?.name;
  return (
    <Modal title={great ? 'The Great Plan' : 'Further the Great Plan'} testId="asterism">
      {great && <p>Pick the Asterism to prophesy for the rest of the battle.</p>}
      {!great && key === null && (
        <p>
          Pick a prophesied Asterism whose condition you meet (it cannot be picked this way again),
          then prophesy another.
        </p>
      )}
      {!great && key !== null && <p>{keyName} is picked. Pick the Asterism to prophesy.</p>}
      <div className="stack">
        {!great &&
          key === null &&
          d.keys.map((k) => (
            <button
              key={k.id}
              className="btn wide"
              data-key={k.id}
              data-met={k.met}
              disabled={!k.met}
              onClick={() => setKey(k.id)}
            >
              <strong>{k.name}</strong>
              <span className="muted small block">
                {k.met ? 'Condition met: ' : 'Condition not met: '}
                {k.condition}
              </span>
            </button>
          ))}
        {(great || key !== null) &&
          d.options.map((o) => (
            <button
              key={o.id}
              className="btn wide"
              data-asterism={o.id}
              onClick={() => dispatch({ t: 'choose', value: great ? o.id : `${key},${o.id}` })}
            >
              <strong>{o.name}</strong>
              <span className="muted small block">{o.text}</span>
            </button>
          ))}
        {!great && key !== null && (
          <button className="btn wide" onClick={() => setKey(null)}>
            Back
          </button>
        )}
        {!great && key === null && (
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
