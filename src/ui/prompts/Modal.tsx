/** Shared prompt chrome: the modal frame, a die face and the collapsed peek bar. */
import { type ReactNode } from 'react';
import { useUi } from '../game/uiStore.js';

export function Modal({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scrim" />
      <section className="modal" data-testid={testId}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

/** Shown on the end-of-turn prompts: what waits behind them. */
export function EndOfTurnNote() {
  return (
    <p className="small end-turn-note" data-testid="end-turn-note">
      The turn is ending. End-of-turn abilities (heals, Huntmaster&apos;s Strike) come after the
      pending reactions, so deal with these first.
    </p>
  );
}

export function Die({ value }: { value: number }) {
  return (
    <span className="die" aria-label={`rolled ${value}`}>
      {value}
    </span>
  );
}

/** The collapsed form of a prompt: a small bar that leaves the board free. */
export function PeekBar({
  onReopen,
  label = 'Reaction',
}: {
  onReopen: () => void;
  /** What is waiting: "Reaction", "Pick the fugitive"... */
  label?: string;
}) {
  return (
    <div className="peek-bar" data-testid="reaction-bar" role="region" aria-label={label}>
      <span className="peek-label">{label} waiting</span>
      <button
        className="btn primary"
        data-testid="reaction-reopen"
        onClick={() => {
          useUi.getState().openDrawer(null);
          onReopen();
        }}
      >
        Back to {label.toLowerCase()}
      </button>
    </div>
  );
}
