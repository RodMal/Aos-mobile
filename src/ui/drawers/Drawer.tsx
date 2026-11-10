import type { ReactNode } from 'react';
import { useUi } from '../game/uiStore.js';
import { Icon } from '../components/Icon.js';

/** A full-height panel sliding in from the side, closed by its button or the scrim. */
export function Drawer({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  const close = () => useUi.getState().openDrawer(null);
  return (
    <div className="drawer-wrap" role="dialog" aria-label={title}>
      <div className="scrim" onClick={close} />
      <section className="drawer" data-testid={testId}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  );
}
