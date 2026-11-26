/** Scything Blade, End Given Form, Pulled to the Grave: pick the units the move passed across. */
import { useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { Modal } from './Modal.js';

const NAMES = {
  scything: 'Scything Blade',
  endGivenForm: 'End Given Form',
  pulled: 'Pulled to the Grave',
} as const;

export function SweepPrompt({ d }: { d: Extract<Decision, { kind: 'sweep' }> }) {
  const state = useGameState();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < d.max ? [...p, id] : p,
    );
  const name = NAMES[d.sweep];
  return (
    <Modal title={name} testId="sweep-targets">
      <p>
        {state.units[d.unit]?.name ?? 'The manifestation'} passed across {d.units.length} enemy
        units. Pick {d.max === 1 ? 'one' : `up to ${d.max}`} to take mortal damage.
      </p>
      <div className="ready" role="group" aria-label="Targets">
        {d.units.map((id) => (
          <button
            key={id}
            className={`chip enemy ${picked.includes(id) ? 'chosen' : ''}`}
            aria-pressed={picked.includes(id)}
            data-sweep={id}
            onClick={() => toggle(id)}
          >
            {state.units[id]?.name ?? id}
          </button>
        ))}
      </div>
      <div className="stack">
        <button
          className="btn primary wide"
          data-testid="sweep-confirm"
          disabled={picked.length === 0}
          onClick={() => dispatch({ t: 'choose', value: picked.join(',') })}
        >
          Strike
        </button>
      </div>
    </Modal>
  );
}
