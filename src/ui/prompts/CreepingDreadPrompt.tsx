/** Creeping Dread. */
import { useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { Modal } from './Modal.js';

/** Creeping Dread: tick up to `max` enemy units in the overgrowth, then use it or pass. */
export function CreepingDreadPrompt({ d }: { d: Extract<Decision, { kind: 'creepingDread' }> }) {
  const state = useGameState();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < d.max ? [...p, id] : p,
    );
  return (
    <Modal title="Creeping Dread" testId="creeping-dread">
      <p>
        Pick {d.max === 1 ? 'an enemy unit' : `up to ${d.max} enemy units`} in the creeping
        overgrowth. This turn, the first command your opponent uses for it costs 1 more CP unless it
        is wholly within 12&quot; of a Hero.
      </p>
      <div className="ready" role="group" aria-label="Targets">
        {d.units.map((id) => (
          <button
            key={id}
            className={`chip enemy ${picked.includes(id) ? 'chosen' : ''}`}
            aria-pressed={picked.includes(id)}
            data-dread={id}
            onClick={() => toggle(id)}
          >
            {state.units[id]?.name ?? id}
          </button>
        ))}
      </div>
      <div className="stack">
        <button
          className="btn primary wide"
          data-testid="dread-use"
          disabled={picked.length === 0}
          onClick={() => dispatch({ t: 'choose', value: picked.join(',') })}
        >
          Use Creeping Dread
        </button>
        <button
          className="btn wide"
          data-testid="dread-pass"
          onClick={() => dispatch({ t: 'pass' })}
        >
          Pass
        </button>
      </div>
    </Modal>
  );
}
