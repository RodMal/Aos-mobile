/** Round, turn, phase track and the score. */
import { PHASES } from '../../engine/index.js';
import { phaseName } from '../game/actions.js';
import { playerName, scenario } from '../game/engine.js';
import { useGameState, useHuman } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Icon } from '../components/Icon.js';

export function TopBar() {
  const state = useGameState();
  const human = useHuman();
  const openDrawer = useUi((s) => s.openDrawer);
  const enemy = human === 0 ? 1 : 0;
  const yourTurn = state.active === human;
  const phaseIndex = PHASES.indexOf(state.phase);
  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-row">
        <button
          className="icon-btn"
          aria-label="Menu"
          onClick={() => openDrawer('menu')}
          data-testid="menu-button"
        >
          <Icon name="menu" />
        </button>
        <div className="round" data-testid="round">
          <span className="round-label">Round {state.round}</span>
          <span className="round-of">/{scenario.rounds}</span>
          <span className={`turn-chip ${yourTurn ? 'friendly' : 'enemy'}`} data-testid="turn">
            {yourTurn ? 'Your turn' : `${playerName(enemy)} turn`}
          </span>
        </div>
        <div className="score" aria-label="Score">
          <div className="score-side friendly" title={playerName(human)}>
            <span className="side-mark friendly" aria-hidden="true" />
            <span className="vp" data-testid="vp-you">
              {state.players[human].vp}
            </span>
            <span className="cp">{state.players[human].cp} CP</span>
            {state.players[human].furyLevel != null && (
              <span className="cp" data-testid="fury-you" title="Fury level & Rage dice">
                F{state.players[human].furyLevel} · {state.players[human].rageDice ?? 0}R
              </span>
            )}
          </div>
          <div className="score-side enemy" title={playerName(enemy)}>
            <span className="side-mark enemy" aria-hidden="true" />
            <span className="vp">{state.players[enemy].vp}</span>
            <span className="cp">{state.players[enemy].cp} CP</span>
            {state.players[enemy].furyLevel != null && (
              <span className="cp" data-testid="fury-enemy" title="Fury level & Rage dice">
                F{state.players[enemy].furyLevel} · {state.players[enemy].rageDice ?? 0}R
              </span>
            )}
          </div>
        </div>
      </div>
      <ol
        className={`phases ${yourTurn ? 'friendly' : 'enemy'}`}
        aria-label="Phase"
        data-testid="phase"
      >
        {PHASES.map((p, i) => (
          <li
            key={p}
            className={i === phaseIndex ? 'current' : i < phaseIndex ? 'done' : ''}
            aria-current={i === phaseIndex ? 'step' : undefined}
          >
            {i === phaseIndex ? phaseName(p) : phaseName(p)[0]}
          </li>
        ))}
      </ol>
    </header>
  );
}
