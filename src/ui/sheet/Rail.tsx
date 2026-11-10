/** Floating controls above the sheet: drawers on the left, zoom on the right, toast between. */
import { useEffect } from 'react';
import { useGame } from '../game/instance.js';
import { canUndo } from '../game/store.js';
import { useUi } from '../game/uiStore.js';
import { Icon } from '../components/Icon.js';

function Toast() {
  const toast = useGame((s) => s.toast);
  const clear = useGame((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, toast.tone === 'error' ? 4500 : 3000);
    return () => clearTimeout(t);
  }, [toast, clear]);
  if (!toast) return <div className="toast-slot" />;
  return (
    <div className="toast-slot">
      <button
        key={toast.id}
        className={`toast ${toast.tone}`}
        role="status"
        data-testid="toast"
        onClick={() => useUi.getState().openDrawer('log')}
      >
        {toast.text}
      </button>
    </div>
  );
}

export function Rail() {
  const openDrawer = useUi((s) => s.openDrawer);
  const moveCamera = useUi((s) => s.moveCamera);
  const undoable = useGame((s) => canUndo(s.session));
  const undo = useGame((s) => s.undo);
  return (
    <div className="rail">
      <div className="rail-col">
        <button className="fab" aria-label="Roster" onClick={() => openDrawer('roster')}>
          <Icon name="roster" />
        </button>
        <button className="fab" aria-label="Log" onClick={() => openDrawer('log')}>
          <Icon name="log" />
        </button>
        {undoable && (
          <button className="fab" aria-label="Undo" onClick={undo}>
            <Icon name="undo" />
          </button>
        )}
      </div>
      <Toast />
      <div className="rail-col">
        <button
          className="fab"
          aria-label="Zoom in"
          onClick={() => moveCamera({ kind: 'zoom', factor: 1.6 })}
        >
          <Icon name="plus" />
        </button>
        <button
          className="fab"
          aria-label="Zoom out"
          onClick={() => moveCamera({ kind: 'zoom', factor: 1 / 1.6 })}
        >
          <Icon name="minus" />
        </button>
        <button
          className="fab"
          aria-label="Show whole table"
          onClick={() => moveCamera({ kind: 'fit' })}
        >
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}
