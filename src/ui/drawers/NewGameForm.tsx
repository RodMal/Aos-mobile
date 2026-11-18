/** The new-game choices (who to play, how to set up, an optional seed), shared by the menu and the start screen. */
import { useState } from 'react';
import type { PlayerId } from '../../engine/index.js';
import { playerName } from '../game/engine.js';
import { useGame } from '../game/instance.js';
import { randomSeed } from '../game/store.js';
import { useUi } from '../game/uiStore.js';

export function NewGameForm({ initialSide }: { initialSide: PlayerId }) {
  const newGame = useGame((s) => s.newGame);
  const [side, setSide] = useState<PlayerId>(initialSide);
  const [deploy, setDeploy] = useState<boolean>(true);
  const [seed, setSeed] = useState('');

  const start = () => {
    const ui = useUi.getState();
    const n = /^\d+$/.test(seed.trim()) ? Number(seed.trim()) : randomSeed();
    ui.reset();
    newGame(n, side, { deploy });
    ui.moveCamera({ kind: 'fit' });
  };

  return (
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
  );
}
