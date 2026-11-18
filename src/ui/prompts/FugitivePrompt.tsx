/** Burning for Vengeance fugitive pick. */
import { useEffect, useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Modal, PeekBar } from './Modal.js';

/** Burning for Vengeance: the candidates are outlined on the board; pick one from the list. */
export function FugitivePrompt({ d }: { d: Extract<Decision, { kind: 'fugitive' }> }) {
  const state = useGameState();
  const [peek, setPeek] = useState(false);
  const [hot, setHot] = useState<string | null>(null);
  const setFlagged = useUi((s) => s.setFlagged);
  useEffect(() => {
    setFlagged(d.units.filter((id) => state.units[id]?.status === 'battlefield'));
    return () => setFlagged([]);
  }, [d.units, state, setFlagged]);
  const show = (id: string) => {
    if (state.units[id]?.status === 'battlefield') {
      useUi.getState().moveCamera({ kind: 'unit', unit: id, zoom: false, onlyIfHidden: true });
    }
  };
  if (peek) return <PeekBar label="Fugitive pick" onReopen={() => setPeek(false)} />;
  return (
    <Modal title="Burning for Vengeance" testId="fugitive">
      <p>
        Pick an enemy Hero to be the <strong>fugitive</strong> for the rest of the battle. Quick
        Pursuit and Bring Them In are scored against it (or completed once it is gone). The
        candidates are outlined on the board.
      </p>
      <div className="stack">
        <button className="btn wide" data-testid="fugitive-see-map" onClick={() => setPeek(true)}>
          See the map
        </button>
        {d.units.map((id) => {
          const u = state.units[id];
          return (
            <button
              key={id}
              className={`btn wide ${hot === id ? 'chosen' : ''}`}
              data-fugitive={id}
              onPointerEnter={(e) => e.pointerType === 'mouse' && (setHot(id), show(id))}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setHot(null)}
              onClick={() => dispatch({ t: 'choose', value: id })}
            >
              {u?.name ?? id}
              {u?.status === 'reserve' && <span className="muted small"> · in reserve</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
