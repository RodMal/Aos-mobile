/** Modal prompts: priority, reactions, confirmations, the unit chooser and the result screen. */
import type { ReactNode } from 'react';
import { dispatch } from '../game/actions.js';
import { COMMAND_NAMES, reactionText } from '../game/eventText.js';
import { logContext, playerName } from '../game/engine.js';
import { useGame } from '../game/instance.js';
import { useGameState, useHuman, useHumanDecision } from '../game/hooks.js';
import { randomSeed } from '../game/store.js';
import { useUi } from '../game/uiStore.js';

function Modal({
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

function Die({ value }: { value: number }) {
  return (
    <span className="die" aria-label={`rolled ${value}`}>
      {value}
    </span>
  );
}

export function DecisionPrompts() {
  const d = useHumanDecision();
  const state = useGameState();
  const human = useHuman();
  if (!d) return null;
  if (d.kind === 'priority') {
    return (
      <Modal title="Priority roll" testId="priority">
        <div className="dice-pair">
          <div>
            <Die value={d.rolls[0]} />
            <span className="muted small">{playerName(0)}</span>
          </div>
          <div>
            <Die value={d.rolls[1]} />
            <span className="muted small">{playerName(1)}</span>
          </div>
        </div>
        <p>You choose who takes the first turn of round {state.round}.</p>
        <div className="stack">
          <button
            className="btn primary wide"
            onClick={() => dispatch({ t: 'choose', value: 'first' })}
          >
            Take first turn
          </button>
          <button className="btn wide" onClick={() => dispatch({ t: 'choose', value: 'second' })}>
            Take second turn
          </button>
        </div>
      </Modal>
    );
  }
  if (d.kind === 'reaction') {
    const cp = state.players[human].cp;
    return (
      <Modal title="Reaction" testId="reaction">
        <p>{reactionText(d.trigger, logContext(state.units))}</p>
        <div className="stack">
          {d.options.map((o, i) => {
            const unitName = state.units[o.unit]?.name ?? o.unit;
            if (o.ability === 'unbind') {
              return (
                <button
                  key={i}
                  className="btn wide"
                  onClick={() => dispatch({ t: 'ability', unit: o.unit, abilityId: 'unbind' })}
                >
                  Unbind · {unitName} · Free
                </button>
              );
            }
            if (!o.command) return null;
            const command = o.command;
            return (
              <button
                key={i}
                className="btn wide"
                disabled={o.cost > cp}
                onClick={() => dispatch({ t: 'command', command, unit: o.unit })}
              >
                {COMMAND_NAMES[command]} · {unitName} · {o.cost} CP
              </button>
            );
          })}
          <button className="btn primary wide" onClick={() => dispatch({ t: 'pass' })}>
            Skip
          </button>
        </div>
      </Modal>
    );
  }
  return null;
}

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
