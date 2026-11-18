/** Several units under one finger: pick which one was meant. */
import { useGameState, useHuman } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';

/** Several units under one finger: pick which one was meant. */
export function Chooser() {
  const chooser = useUi((s) => s.chooser);
  const state = useGameState();
  const human = useHuman();
  if (!chooser) return null;
  const close = () => useUi.getState().setChooser(null);
  return (
    <div className="chooser-wrap">
      <div className="scrim clear" onClick={close} />
      <div
        className="chooser"
        style={{
          left: Math.max(8, Math.min(chooser.x - 110, window.innerWidth - 228)),
          top: chooser.y + 12,
        }}
        data-testid="chooser"
      >
        <p className="muted small">Which unit?</p>
        {chooser.units.map((id) => {
          const u = state.units[id]!;
          return (
            <button
              key={id}
              className="chooser-item"
              onClick={() => useUi.getState().select(id)}
              data-choose-unit={id}
            >
              <span
                className={`side-mark ${u.owner === human ? 'friendly' : 'enemy'}`}
                aria-hidden="true"
              />
              {u.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
