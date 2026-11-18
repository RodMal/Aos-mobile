/** The result screen. */
import { playerName } from '../game/engine.js';
import { useGame } from '../game/instance.js';
import { useGameState, useHuman } from '../game/hooks.js';
import { randomSeed } from '../game/store.js';
import { useUi } from '../game/uiStore.js';
import { Modal } from './Modal.js';

export function GameEnd() {
  const state = useGameState();
  const human = useHuman();
  const newGame = useGame((s) => s.newGame);
  if (state.status !== 'ended') return null;
  const enemy = human === 0 ? 1 : 0;
  const title = state.winner === 'draw' ? 'A draw' : state.winner === human ? 'Victory' : 'Defeat';
  return (
    <Modal title={title} testId="game-end">
      <table className="vp-table">
        <thead>
          <tr>
            <th>Round</th>
            <th>{playerName(human)}</th>
            <th>{playerName(enemy)}</th>
          </tr>
        </thead>
        <tbody>
          {state.players[human].vpByRound.map((vp, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{vp}</td>
              <td>{state.players[enemy].vpByRound[i] ?? 0}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td>{state.players[human].vp}</td>
            <td>{state.players[enemy].vp}</td>
          </tr>
        </tbody>
      </table>
      <div className="stack">
        <button
          className="btn primary wide"
          onClick={() => {
            useUi.getState().reset();
            newGame(randomSeed(), human);
            useUi.getState().moveCamera({ kind: 'fit' });
          }}
        >
          New game
        </button>
        <button className="btn wide" onClick={() => useUi.getState().openDrawer('log')}>
          Battle log
        </button>
      </div>
    </Modal>
  );
}
