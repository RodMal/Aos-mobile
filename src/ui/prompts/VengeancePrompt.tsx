/** Vengeance of Azyr (Sunclaw Starhost). */
import { useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { EndOfTurnNote, Modal } from './Modal.js';

/**
 * Vengeance of Azyr at the end of a turn: tick up to 3 units, then use it or skip. Each picked
 * unit piles in on the board, then strikes an enemy in combat with it (picked here when
 * there are several).
 */
export function VengeancePrompt({ d }: { d: Extract<Decision, { kind: 'vengeance' }> }) {
  const state = useGameState();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < d.max ? [...p, id] : p,
    );
  const name = (id: string) => state.units[id]?.name ?? id;
  if (d.stage === 'enemy') {
    return (
      <Modal title="Vengeance of Azyr" testId="vengeance">
        <p>
          {name(d.unit ?? '')} strikes: pick the enemy unit in combat with it. Roll a D3; on a 2+ it
          takes that much mortal damage.
        </p>
        <div className="stack">
          {d.units.map((id) => (
            <button
              key={id}
              className="btn wide"
              data-vengeance-enemy={id}
              onClick={() => dispatch({ t: 'choose', value: id })}
            >
              {name(id)}
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Vengeance of Azyr" testId="vengeance">
      <EndOfTurnNote />
      <p>
        Pick up to {d.max} Saurus or Kroxigor units in combat. Each makes a pile-in move, then rolls
        a D3 against an enemy unit in combat with it: on a 2+ that unit takes that much mortal
        damage.
      </p>
      <div className="ready" role="group" aria-label="Units">
        {d.units.map((id) => (
          <button
            key={id}
            className={`chip ${picked.includes(id) ? 'chosen' : ''}`}
            aria-pressed={picked.includes(id)}
            data-vengeance={id}
            onClick={() => toggle(id)}
          >
            {name(id)}
          </button>
        ))}
      </div>
      <div className="stack">
        <button
          className="btn primary wide"
          data-testid="vengeance-use"
          disabled={picked.length === 0}
          onClick={() => dispatch({ t: 'choose', value: `vengeance:${picked.join(',')}` })}
        >
          Use Vengeance of Azyr
        </button>
        <button
          className="btn wide"
          data-testid="vengeance-skip"
          onClick={() => dispatch({ t: 'choose', value: 'none' })}
        >
          Skip
        </button>
      </div>
    </Modal>
  );
}
