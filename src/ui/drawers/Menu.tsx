/** New game, resume, army rules, and the game record for bug reports. */
import { useState } from 'react';
import { useGame } from '../game/instance.js';
import { toRecord } from '../game/session.js';
import { useUi } from '../game/uiStore.js';
import { Drawer } from './Drawer.js';
import { NewGameForm } from './NewGameForm.js';

export function Menu() {
  const session = useGame((s) => s.session);
  const showToast = useGame((s) => s.showToast);
  const [record, setRecord] = useState<string | null>(null);
  const ui = useUi.getState();

  const copy = async () => {
    const json = JSON.stringify(toRecord(session));
    setRecord(json);
    try {
      await navigator.clipboard.writeText(json);
      showToast('Game record copied');
    } catch {
      showToast('Copy the record from the box below');
    }
  };

  return (
    <Drawer title="Menu" testId="menu">
      <button className="btn primary wide" onClick={() => ui.openDrawer(null)} data-testid="resume">
        Resume game
      </button>
      <button
        className="btn wide"
        onClick={() => ui.openDrawer('army')}
        data-testid="open-army-rules"
      >
        Army rules
      </button>
      <NewGameForm initialSide={session.humanPlayer} />
      <section className="menu-section">
        <h3>Game record</h3>
        <p className="muted small">
          Seed {session.seed} · {session.history.length} actions. The record replays this game
          exactly; attach it to bug reports.
        </p>
        <button className="btn wide" onClick={copy}>
          Copy game record
        </button>
        {record && (
          <textarea
            className="record"
            readOnly
            value={record}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </section>
      <p className="muted small credits" data-testid="version-tag">
        AoS Mobile · Milestone M3b (Fury Season & Battle Tactics)
        <br />
        Game data from the community BSData project. Warhammer Age of Sigmar is © Games Workshop.
        Unofficial fan project.
      </p>
    </Drawer>
  );
}
