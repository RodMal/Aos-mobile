/** New game, resume, army rules, and the game record for bug reports. */
import { useState } from 'react';
import type { PlayerId } from '../../engine/index.js';
import { playerName } from '../game/engine.js';
import { useGame } from '../game/instance.js';
import { toRecord } from '../game/session.js';
import { randomSeed } from '../game/store.js';
import { useUi } from '../game/uiStore.js';
import { Drawer } from './Drawer.js';

export function Menu() {
  const session = useGame((s) => s.session);
  const newGame = useGame((s) => s.newGame);
  const showToast = useGame((s) => s.showToast);
  const [side, setSide] = useState<PlayerId>(session.humanPlayer);
  const [deploy, setDeploy] = useState<boolean>(true);
  const [seed, setSeed] = useState('');
  const [record, setRecord] = useState<string | null>(null);
  const ui = useUi.getState();

  const start = () => {
    const n = /^\d+$/.test(seed.trim()) ? Number(seed.trim()) : randomSeed();
    ui.reset();
    newGame(n, side, { deploy });
    ui.moveCamera({ kind: 'fit' });
  };

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
      <section className="menu-section">
        <h3>New game</h3>
        <p className="muted small">Play as</p>
        <div className="seg" role="radiogroup" aria-label="Play as">
          {([0, 1] as PlayerId[]).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={side === p}
              className={`seg-btn ${side === p ? 'on' : ''}`}
              onClick={() => setSide(p)}
            >
              {playerName(p)}
            </button>
          ))}
        </div>
        <p className="muted small">Setup</p>
        <div className="seg" role="radiogroup" aria-label="Setup mode">
          <button
            role="radio"
            aria-checked={deploy}
            className={`seg-btn ${deploy ? 'on' : ''}`}
            onClick={() => setDeploy(true)}
          >
            Alternating deploy
          </button>
          <button
            role="radio"
            aria-checked={!deploy}
            className={`seg-btn ${!deploy ? 'on' : ''}`}
            onClick={() => setDeploy(false)}
          >
            Quick start
          </button>
        </div>
        <label className="field">
          <span className="muted small">Seed (optional)</span>
          <input
            inputMode="numeric"
            className="input"
            placeholder="random"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </label>
        <button className="btn wide" onClick={start} data-testid="start-new-game">
          Start new game
        </button>
      </section>
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
