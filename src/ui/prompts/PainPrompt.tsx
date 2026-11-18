/** Fight Through the Pain. */
import { useEffect, useState } from 'react';
import type { ReactionOption } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Modal, PeekBar } from './Modal.js';

/** Fight Through the Pain: the incoming damage, how many rage dice to spend, or take it all. */
export function PainPrompt({ option, fury }: { option: ReactionOption; fury: number }) {
  const state = useGameState();
  const max = option.maxRageDice ?? 0;
  const damage = option.damage ?? 0;
  const [dice, setDice] = useState(Math.min(max, damage));
  const name = state.units[option.unit]?.name ?? option.unit;
  const [peek, setPeek] = useState(false);
  const setFlagged = useUi((s) => s.setFlagged);
  useEffect(() => {
    setFlagged([option.unit]);
    return () => setFlagged([]);
  }, [option.unit, setFlagged]);
  if (peek) return <PeekBar onReopen={() => setPeek(false)} />;
  return (
    <Modal title="Fight Through the Pain" testId="reaction">
      <p data-testid="pain-damage">
        <strong>{name}</strong> is about to take <strong>{damage} damage</strong>.
      </p>
      <p className="muted small">
        Each rage die spent lowers your fury level by 1 (now {fury}) and removes 1 damage on a 3+.
      </p>
      <div className="stepper" role="group" aria-label="Rage dice">
        <span className="stepper-label">Rage dice</span>
        <button
          className="btn"
          aria-label="Fewer rage dice"
          disabled={dice <= 1}
          onClick={() => setDice(dice - 1)}
        >
          −
        </button>
        <span className="stepper-value" data-testid="pain-dice">
          {dice}
        </span>
        <button
          className="btn"
          aria-label="More rage dice"
          disabled={dice >= max}
          onClick={() => setDice(dice + 1)}
        >
          +
        </button>
        <span className="muted small">of {max}</span>
      </div>
      <div className="stack">
        <button className="btn wide" data-testid="reaction-see-map" onClick={() => setPeek(true)}>
          See the map
        </button>
        <button
          className="btn wide"
          data-testid="pain-spend"
          onClick={() =>
            dispatch({
              t: 'ability',
              unit: option.unit,
              abilityId: 'fight-through-the-pain',
              rageDice: dice,
            })
          }
        >
          Spend {dice} rage {dice === 1 ? 'die' : 'dice'}
        </button>
        <button
          className="btn primary wide"
          data-testid="pain-skip"
          onClick={() => dispatch({ t: 'pass' })}
        >
          Take the damage
        </button>
      </div>
    </Modal>
  );
}
