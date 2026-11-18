/** Alarielle Season of War, and the Burgeoning terrain step. */
import { useEffect, useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { scenario } from '../game/engine.js';
import { useGameState } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Modal, PeekBar } from './Modal.js';

/**
 * The Burgeoning: Ever Growing may name any terrain feature the opponent does not control. The
 * features are outlined on the board; a choice is answered as `burgeoning:<feature id>`.
 */
export function SeasonPrompt({ d }: { d: Extract<Decision, { kind: 'alarielleSeason' }> }) {
  const state = useGameState();
  const [stage, setStage] = useState<'season' | 'terrain'>('season');
  const [peek, setPeek] = useState(false);
  const setFlagged = useUi((s) => s.setFlagged);
  const setFlaggedTerrain = useUi((s) => s.setFlaggedTerrain);
  const last = state.alarielleSeason?.[state.round - 1];
  useEffect(() => {
    if (stage !== 'terrain') return;
    const onTable = new Set(scenario.battlefield.terrain.map((t) => t.id));
    setFlaggedTerrain(d.features.map((f) => f.id).filter((id) => onTable.has(id)));
    setFlagged(d.features.map((f) => f.id).filter((id) => state.units[id]));
    return () => {
      setFlaggedTerrain([]);
      setFlagged([]);
    };
  }, [stage, d.features, state, setFlagged, setFlaggedTerrain]);
  if (stage === 'terrain') {
    if (peek) return <PeekBar label="Terrain pick" onReopen={() => setPeek(false)} />;
    return (
      <Modal title="The Burgeoning" testId="burgeoning">
        <p>
          Ever Growing may name any terrain feature the opponent does not control. Pick the one that
          gets an overgrown token (the others that could be picked are outlined).
        </p>
        <div className="stack">
          <button
            className="btn wide"
            data-testid="burgeoning-see-map"
            onClick={() => setPeek(true)}
          >
            See the map
          </button>
          {d.features.map((f) => (
            <button
              key={f.id}
              className="btn wide"
              data-feature={f.id}
              onClick={() => dispatch({ t: 'choose', value: `burgeoning:${f.id}` })}
            >
              {f.name}
            </button>
          ))}
          <button
            className="btn wide"
            data-testid="burgeoning-auto"
            onClick={() => dispatch({ t: 'choose', value: 'burgeoning' })}
          >
            Closest to the centre
          </button>
          <button className="btn wide" onClick={() => setStage('season')}>
            Back
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Alarielle: Season of War" testId="alarielle-season">
      <p>Pick a Season of War for the rest of this battle round (not last round&apos;s):</p>
      <div className="stack">
        {SEASONS.map((x) => (
          <button
            key={x.id}
            className="btn wide"
            data-season={x.id}
            disabled={!d.seasons.includes(x.id)}
            onClick={() =>
              x.id === 'burgeoning' && d.features.length > 0
                ? setStage('terrain')
                : dispatch({ t: 'choose', value: x.id })
            }
          >
            <strong>{x.name}</strong>
            <span className="muted small block">
              {x.id === last ? 'Picked last battle round' : x.text}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

const SEASONS = [
  {
    id: 'burgeoning',
    name: 'The Burgeoning',
    text: 'Ever Growing may target any terrain feature the opponent does not control',
  },
  {
    id: 'reaping',
    name: 'The Reaping',
    text: '+1 to cast and chant wholly within 12" of Alarielle',
  },
  {
    id: 'dwindling',
    name: 'The Dwindling',
    text: 'Charge after retreating; no retreat mortal damage',
  },
  { id: 'everdusk', name: 'Everdusk', text: 'Creeping Dread can pick up to 3 enemy units' },
] as const;
