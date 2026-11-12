/** Nothing selected: the current decision in words and its one obvious button. */
import { useMemo } from 'react';
import { aliveCount, unitsOf, type Decision } from '../../engine/index.js';
import { dispatch, endPhase, phaseName } from '../game/actions.js';
import { engine, playerName } from '../game/engine.js';
import { useDecision, useGameState, useHuman } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { TacticsPanel } from '../drawers/TacticsDrawer.js';

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
        ? { title: 'Pick a unit to fight', hint: 'These units can fight now.' }
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
      if (d.reason)
        return mine
          ? { title: 'Choose the first turn', hint: 'Choose who takes the first turn.' }
          : { title: `${who} choose the first turn`, hint: 'The opponent is choosing…' };
      return mine
        ? { title: 'You won the priority roll', hint: 'Choose who takes the first turn.' }
        : { title: `${who} won the priority roll`, hint: 'The opponent is choosing…' };
    case 'reaction':
      return mine
        ? { title: 'Reaction', hint: 'Use a command, or skip.' }
        : { title: `${who} may react`, hint: 'The opponent is deciding…' };
    case 'placeOfPower':
      return mine
        ? { title: 'Place of Power', hint: 'Choose a boon or pass.' }
        : { title: `${who} at Place of Power`, hint: 'The opponent is choosing…' };
    case 'alarielleSeason':
      return mine
        ? { title: 'Season of War', hint: 'Pick a season of war for this battle round.' }
        : { title: `${who} season of war`, hint: 'The opponent is choosing…' };
    case 'creepingDread':
      return mine
        ? { title: 'Creeping Dread', hint: 'Pick enemy units in the overgrowth, or pass.' }
        : { title: `${who} Creeping Dread`, hint: 'The opponent is choosing…' };
    case 'fugitive':
      return mine
        ? { title: 'Pick the fugitive', hint: 'Burning for Vengeance: pick an enemy Hero.' }
        : { title: `${who} pick a fugitive`, hint: 'The opponent is choosing…' };
  }
}

/**
 * The human's units that can do something under the current decision, as one-tap chips.
 * Finding a highlighted unit on a small screen is slow; this is the shortcut.
 */
export function ReadyUnits({ label }: { label: string }) {
  const state = useGameState();
  const human = useHuman();
  const ready = useMemo(
    () => unitsOf(state, human).filter((u) => engine.unitOptions(state, u.id).length > 0),
    [state, human],
  );
  if (ready.length === 0) return null;
  const choose = (id: string) => {
    const ui = useUi.getState();
    ui.select(id);
    ui.moveCamera({ kind: 'unit', unit: id, zoom: false, onlyIfHidden: false });
  };
  return (
    <div className="ready" data-testid="ready-units">
      <span className="ready-label">{label}</span>
      {ready.map((u) => (
        <button key={u.id} className="chip" data-ready-unit={u.id} onClick={() => choose(u.id)}>
          {u.name}
          {u.models.length > 1 && <span className="chip-count">{aliveCount(u)}</span>}
        </button>
      ))}
    </div>
  );
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
      {mine && d.kind === 'main' && <ReadyUnits label="Can act" />}
      {mine && d.kind === 'fightPick' && <ReadyUnits label="Can fight" />}
      {mine && d.kind === 'main' && (
        <button className="btn primary wide" onClick={endPhase} data-testid="end-phase">
          End {d.phase === 'end' ? 'turn' : `${phaseName(d.phase).toLowerCase()} phase`}
        </button>
      )}
      {mine && d.kind === 'fightPick' && d.canPass && (
        <button className="btn wide" onClick={() => dispatch({ t: 'pass' })}>
          Pass
        </button>
      )}
      {!mine && <div className="thinking" aria-hidden="true" />}
      {/* Desktop: the battle tactics tracker stays in view below the decision. */}
      <div className="desktop-tactics">
        <TacticsPanel testId="tactics-sheet" />
      </div>
    </div>
  );
}
