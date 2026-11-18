/** Shared prompt chrome: the modal frame, a die face and the collapsed peek bar. */
import { type ReactNode } from 'react';

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
      <span className="small">{label} waiting</span>
      <button className="btn primary" data-testid="reaction-reopen" onClick={onReopen}>
        Back to {label.toLowerCase()}
      </button>
    </div>
  );
}
