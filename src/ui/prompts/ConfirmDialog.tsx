/** The confirmation dialog. */
import { useUi } from '../game/uiStore.js';
import { Modal } from './Modal.js';

export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const close = useUi((s) => s.closeConfirm);
  if (!confirm) return null;
  return (
    <Modal title="Are you sure?" testId="confirm">
      <p>{confirm.text}</p>
      <div className="confirm-row">
        <button className="btn" onClick={close}>
          Go back
        </button>
        <button
          className="btn primary grow"
          data-testid="confirm-ok"
          onClick={() => {
            close();
            confirm.action();
          }}
        >
          {confirm.ok}
        </button>
      </div>
    </Modal>
  );
}
