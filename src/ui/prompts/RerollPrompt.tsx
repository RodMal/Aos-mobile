/** Glamourweave: re-roll a failed hit, wound or save roll, or keep the re-roll for a later one. */
import { useEffect, useState } from 'react';
import type { ReactionOption } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Modal, PeekBar } from './Modal.js';

const ROLL_NAMES = { hit: 'hit roll', wound: 'wound roll', save: 'save roll' } as const;

export function RerollPrompt({ option }: { option: ReactionOption }) {
  const state = useGameState();
  const [peek, setPeek] = useState(false);
  const setFlagged = useUi((s) => s.setFlagged);
  const roll = option.reroll!;
  useEffect(() => {
    setFlagged([option.unit]);
    return () => setFlagged([]);
  }, [option.unit, setFlagged]);
  if (peek) return <PeekBar onReopen={() => setPeek(false)} />;
  const name = state.units[option.unit]?.name ?? option.unit;
  const target = state.units[roll.target]?.name ?? roll.target;
  return (
    <Modal title="Glamourweave" testId="reaction">
      <p data-testid="reroll-text">
        {roll.kind === 'save' ? (
          <>
            <strong>{name}</strong> failed a save roll against {roll.weapon}:{' '}
            <strong>{roll.die}</strong>.
          </>
        ) : (
          <>
            <strong>{name}</strong> failed a {ROLL_NAMES[roll.kind]} with {roll.weapon} against{' '}
            {target}: <strong>{roll.die}</strong>.
          </>
        )}
      </p>
      <p className="muted small">
        Glamourweave lets this unit re-roll one {roll.kind} roll each phase. Keep it to use the
        re-roll on a later failed {ROLL_NAMES[roll.kind]} this phase.
      </p>
      <div className="stack">
        <button className="btn wide" data-testid="reaction-see-map" onClick={() => setPeek(true)}>
          See the map
        </button>
        <button
          className="btn wide"
          data-testid="reroll-use"
          onClick={() => dispatch({ t: 'ability', unit: option.unit, abilityId: 'glamourweave' })}
        >
          Re-roll the {roll.die}
        </button>
        <button
          className="btn primary wide"
          data-testid="reroll-keep"
          onClick={() => dispatch({ t: 'pass' })}
        >
          Keep it
        </button>
      </div>
    </Modal>
  );
}
