/** Place the Venomites token next to the Sunblood Pack that was just deployed. */
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { tableSide, type Rot, type Side } from '../board/view.js';
import { Modal } from './Modal.js';

/** How the board is turned right now (the phone turns the table to run down the screen). */
function boardRot(): Rot {
  const r = document.querySelector('[data-testid="board"]')?.getAttribute('data-rot');
  return r === '90' ? 90 : r === '-90' ? -90 : 0;
}

const LABEL = { top: 'Above', bottom: 'Below', left: 'Left of', right: 'Right of' } as const;

export function VenomitesPrompt({ d }: { d: Extract<Decision, { kind: 'venomites' }> }) {
  const state = useGameState();
  const name = state.units[d.unit]?.name ?? 'the unit';
  return (
    <Modal title="Venomites token" testId="venomites">
      <p>
        Place the Venomites token next to <strong>{name}</strong>. It stays on the battlefield until
        Venomite Swarm rolls a 1.
      </p>
      <div className="stack">
        {d.sides.map((side) => (
          <button
            key={side}
            className="btn wide"
            data-testid={`venomites-${side}`}
            onClick={() => dispatch({ t: 'choose', value: tableSide(boardRot(), side as Side) })}
          >
            {LABEL[side]} the unit
          </button>
        ))}
      </div>
    </Modal>
  );
}
