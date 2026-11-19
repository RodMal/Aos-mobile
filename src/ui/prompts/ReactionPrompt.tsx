/** A generic reaction. */
import { useEffect, useState } from 'react';
import type { Decision } from '../../engine/index.js';
import { HUNTMASTERS_STRIKE_ID } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { COMMAND_NAMES, reactionText, triggerUnit } from '../game/eventText.js';
import { logContext } from '../game/engine.js';
import { useGameState, useHuman } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Modal, PeekBar } from './Modal.js';

/** A reaction: the choices, plus a way to look at the board (and the units named) first. */
export function ReactionPrompt({ d }: { d: Extract<Decision, { kind: 'reaction' }> }) {
  const state = useGameState();
  const human = useHuman();
  const [peek, setPeek] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const cp = state.players[human].cp;
  const trigger = triggerUnit(d.trigger);
  const listed = [...new Set(d.options.map((o) => o.unit))];
  const setFlagged = useUi((s) => s.setFlagged);
  useEffect(() => {
    setFlagged([trigger, picked, hot].filter((x): x is string => !!x && !!state.units[x]));
    return () => setFlagged([]);
  }, [trigger, picked, hot, state, setFlagged]);
  const show = (id: string) => {
    setPicked(id);
    useUi.getState().moveCamera({ kind: 'unit', unit: id, zoom: false, onlyIfHidden: true });
  };
  if (peek) {
    return <PeekBar onReopen={() => setPeek(false)} />;
  }
  return (
    <Modal title="Reaction" testId="reaction">
      <p data-testid="reaction-text">{reactionText(d.trigger, logContext(state.units))}</p>
      <div className="row-chips" role="group" aria-label="Units">
        {[...(trigger ? [trigger] : []), ...listed.filter((id) => id !== trigger)].map((id) => (
          <button
            key={id}
            className={`chip ${state.units[id]?.owner === human ? '' : 'enemy'} ${picked === id ? 'chosen' : ''}`}
            data-reaction-unit={id}
            aria-pressed={picked === id}
            onClick={() => show(id)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHot(id)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHot(null)}
          >
            {state.units[id]?.name ?? id}
          </button>
        ))}
      </div>
      <div className="stack">
        <button className="btn wide" data-testid="reaction-see-map" onClick={() => setPeek(true)}>
          See the map
        </button>
        {d.options.map((o, i) => {
          const unitName = state.units[o.unit]?.name ?? o.unit;
          const hover = {
            onPointerEnter: () => setHot(o.unit),
            onPointerLeave: () => setHot(null),
          };
          if (o.ability === 'unbind') {
            return (
              <button
                key={i}
                className="btn wide"
                {...hover}
                onClick={() => dispatch({ t: 'ability', unit: o.unit, abilityId: 'unbind' })}
              >
                Unbind · {unitName} · Free
              </button>
            );
          }
          if (o.ability === 'huntmastersStrike') {
            return (
              <button
                key={i}
                className="btn wide"
                data-testid="huntmasters-strike"
                {...hover}
                onClick={() =>
                  dispatch({
                    t: 'ability',
                    unit: o.unit,
                    abilityId: HUNTMASTERS_STRIKE_ID,
                  })
                }
              >
                Huntmaster&apos;s Strike · {unitName} · Free
              </button>
            );
          }
          if (!o.command) return null;
          const command = o.command;
          return (
            <button
              key={i}
              className="btn wide"
              disabled={o.cost > cp}
              {...hover}
              onClick={() => dispatch({ t: 'command', command, unit: o.unit })}
            >
              {COMMAND_NAMES[command]} · {unitName} · {o.cost} CP
            </button>
          );
        })}
        <button className="btn primary wide" onClick={() => dispatch({ t: 'pass' })}>
          Skip
        </button>
      </div>
    </Modal>
  );
}
