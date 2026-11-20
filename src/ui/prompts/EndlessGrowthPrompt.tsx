/** Endless Growth: choose Aspect of Heartwood for a target, then Heal or return slain models. */
import type { Decision } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { useGameState } from '../game/hooks.js';
import { Die, Modal } from './Modal.js';

const ASPECT_LABEL: Record<string, string> = {
  d6: 'Roll a D6 (or Heal 6 instead of Heal 3)',
  kurnothi: 'Return 1 slain model instead of rolling',
  normal: 'Do not use Aspect of Heartwood here',
};

export function EndlessGrowthPrompt({ d }: { d: Extract<Decision, { kind: 'endlessGrowth' }> }) {
  const state = useGameState();
  const name = state.units[d.unit]?.name ?? 'The unit';
  if (d.stage === 'aspect') {
    return (
      <Modal title="Aspect of Heartwood" testId="endless-growth-aspect">
        <p>
          Endless Growth targets <strong>{name}</strong>, within reach of Aspect of Heartwood (once
          per battle). Use it on this target?
        </p>
        <div className="stack">
          {d.options.map((o) => (
            <button
              key={o}
              className={`btn wide ${o === 'normal' ? '' : 'primary'}`}
              data-testid={`growth-${o}`}
              onClick={() => dispatch({ t: 'choose', value: o })}
            >
              {ASPECT_LABEL[o] ?? o}
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Endless Growth" testId="endless-growth">
      <p>
        {name}: rolled <Die value={d.roll ?? 0} />. Choose one effect.
      </p>
      <div className="stack">
        <button
          className="btn primary wide"
          data-testid="growth-return"
          onClick={() => dispatch({ t: 'choose', value: 'return' })}
        >
          Return {d.models} slain model{d.models === 1 ? '' : 's'}
        </button>
        <button
          className="btn wide"
          data-testid="growth-heal"
          onClick={() => dispatch({ t: 'choose', value: 'heal' })}
        >
          Heal {d.heal} damage
        </button>
      </div>
    </Modal>
  );
}
