/** Nothing selected: the current decision in words and its one obvious button. */
import type { Decision } from '../../engine/index.js';
import { dispatch, endPhase, phaseName } from '../game/actions.js';
import { playerName } from '../game/engine.js';
import { useDecision, useHuman } from '../game/hooks.js';

function describe(d: Decision, human: 0 | 1): { title: string; hint: string } {
  const mine = d.player === human;
  const who = mine ? 'Your' : `${playerName(d.player)}`;
  switch (d.kind) {
    case 'main': {
      const phase = phaseName(d.phase).toLowerCase();
      if (!mine) return { title: `${who} ${phase} phase`, hint: 'The opponent is playing…' };
      const hint =
        d.phase === 'movement'
          ? 'Pick a unit to move it, or end the phase.'
          : d.phase === 'shooting'
            ? 'Pick a unit to shoot with, or end the phase.'
            : d.phase === 'charge'
              ? 'Pick a unit to charge with, or end the phase.'
              : 'Pick a unit, or end the phase.';
      return { title: `Your ${phase} phase`, hint };
    }
    case 'fightPick':
      return mine
        ? { title: 'Pick a unit to fight', hint: 'Highlighted units can fight now.' }
        : { title: `${who} pick a unit to fight`, hint: 'The opponent is choosing…' };
    case 'place':
      return mine
        ? { title: 'Place your unit', hint: 'Drag the ghost to where the unit should go.' }
        : { title: `${who} are moving`, hint: 'The opponent is moving a unit…' };
    case 'targets':
      return mine
        ? { title: 'Choose targets', hint: 'Assign each weapon to a target.' }
        : { title: `${who} are attacking`, hint: 'The opponent is choosing targets…' };
    case 'priority':
      return mine
        ? { title: 'You won the priority roll', hint: 'Choose who takes the first turn.' }
        : { title: `${who} won the priority roll`, hint: 'The opponent is choosing…' };
    case 'reaction':
      return mine
        ? { title: 'Reaction', hint: 'Use a command, or skip.' }
        : { title: `${who} may react`, hint: 'The opponent is deciding…' };
  }
}

export function DecisionPanel() {
  const d = useDecision();
  const human = useHuman();
  if (!d) {
    return (
      <div className="panel">
        <h2 className="panel-title">The battle is over</h2>
      </div>
    );
  }
  const { title, hint } = describe(d, human);
  const mine = d.player === human;
  return (
    <div className="panel decision" data-testid="decision">
      <div className="panel-text">
        <h2 className="panel-title">{title}</h2>
        <p className="panel-hint">{hint}</p>
      </div>
      {mine && d.kind === 'main' && (
        <button className="btn primary wide" onClick={endPhase} data-testid="end-phase">
          End {phaseName(d.phase).toLowerCase()} phase
        </button>
      )}
      {mine && d.kind === 'fightPick' && d.canPass && (
        <button className="btn wide" onClick={() => dispatch({ t: 'pass' })}>
          Pass
        </button>
      )}
      {!mine && <div className="thinking" aria-hidden="true" />}
    </div>
  );
}
