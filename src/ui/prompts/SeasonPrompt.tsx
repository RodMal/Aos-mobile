/** Alarielle Season of War, and the Burgeoning terrain step. */
import { useEffect, useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { scenario } from '../game/engine.js';
import { useGameState } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Modal } from './Modal.js';

/**
 * The Burgeoning: each of the player's Awakened Wyldwoods names a terrain feature for Ever
 * Growing (any the opponent does not control, enemy faction terrain included). The player taps
 * the feature on the board, one Wyldwood after the other, with the candidates outlined; the
 * choices are answered as `burgeoning:<wyldwood id>=<feature id>,...`.
 */
export function SeasonPrompt({ d }: { d: Extract<Decision, { kind: 'alarielleSeason' }> }) {
  const state = useGameState();
  const [stage, setStage] = useState<'season' | 'terrain'>('season');
  const [picks, setPicks] = useState<[string, string][]>([]);
  const setFlagged = useUi((s) => s.setFlagged);
  const setFlaggedTerrain = useUi((s) => s.setFlaggedTerrain);
  const setTerrainPick = useUi((s) => s.setTerrainPick);
  const last = state.alarielleSeason?.[state.round - 1];
  const current = d.wyldwoods[picks.length];
  const taken = new Set(picks.map((p) => p[1]));
  const candidates = d.features.map((f) => f.id).filter((id) => !taken.has(id));

  const answer = (chosen: [string, string][]) =>
    dispatch({
      t: 'choose',
      value:
        chosen.length === 0
          ? 'burgeoning'
          : `burgeoning:${chosen.map(([w, f]) => `${w}=${f}`).join(',')}`,
    });

  useEffect(() => {
    if (stage !== 'terrain' || !current) return;
    const onTable = new Set(scenario.battlefield.terrain.map((t) => t.id));
    setFlaggedTerrain(candidates.filter((id) => onTable.has(id)));
    setFlagged(candidates.filter((id) => state.units[id]));
    setTerrainPick({
      candidates,
      onPick: (id) => {
        const next: [string, string][] = [...picks, [current.id, id]];
        if (next.length >= d.wyldwoods.length) answer(next);
        else setPicks(next);
      },
    });
    return () => {
      setFlaggedTerrain([]);
      setFlagged([]);
      setTerrainPick(null);
    };
    // `answer` and `candidates` follow from `picks` and `d`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, d, picks, state, current?.id]);

  if (stage === 'terrain' && current) {
    return (
      <div className="peek-bar terrain-bar" data-testid="burgeoning" role="region">
        <span className="small">
          The Burgeoning: tap the outlined feature for <strong>{current.name}</strong> (
          {picks.length + 1} of {d.wyldwoods.length})
        </span>
        <button
          className="btn"
          data-testid="burgeoning-auto"
          onClick={() => answer(picks)}
          title="Every Wyldwood still to pick takes the feature closest to the centre"
        >
          Closest to the centre
        </button>
        <button
          className="btn"
          onClick={() => {
            setPicks([]);
            setStage('season');
          }}
        >
          Back
        </button>
      </div>
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
              x.id === 'burgeoning' && d.features.length > 0 && d.wyldwoods.length > 0
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
    text: 'Each of your Awakened Wyldwoods may target any terrain feature the opponent does not control',
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
