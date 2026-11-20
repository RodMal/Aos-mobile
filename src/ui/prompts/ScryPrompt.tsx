/** Scry the Stars: the dice are rolled, now pick the units that get Ward (5+). */
import { useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { Die, Modal } from './Modal.js';

export function ScryPrompt({ d }: { d: Extract<Decision, { kind: 'scry' }> }) {
  const state = useGameState();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < d.max ? [...p, id] : p,
    );
  return (
    <Modal title="Scry the Stars" testId="scry-stars">
      <p>
        {state.units[d.unit]?.name ?? 'The unit'} rolled{' '}
        {d.dice.map((v, i) => (
          <Die key={i} value={v} />
        ))}
        . Each 3+ gives Ward (5+) to a friendly Seraphon unit wholly within 18&quot; until the start
        of your next turn. Pick {d.max === 1 ? 'a unit' : `up to ${d.max} units`}.
      </p>
      <div className="ready" role="group" aria-label="Units">
        {d.units.map((id) => (
          <button
            key={id}
            className={`chip ${picked.includes(id) ? 'chosen' : ''}`}
            aria-pressed={picked.includes(id)}
            data-scry={id}
            onClick={() => toggle(id)}
          >
            {state.units[id]?.name ?? id}
          </button>
        ))}
      </div>
      <div className="stack">
        <button
          className="btn primary wide"
          data-testid="scry-confirm"
          disabled={picked.length === 0}
          onClick={() => dispatch({ t: 'choose', value: picked.join(',') })}
        >
          Give Ward (5+)
        </button>
      </div>
    </Modal>
  );
}
