/** Nothing selected: the current decision in words and its one obvious button. */
import { useMemo } from 'react';
import { aliveCount, unitsOf, type Decision, type UnitOption } from '../../engine/index.js';
import { ambushUnits } from '../../engine/reserve.js';
import { dispatch, endPhase, optionLabel, phaseName } from '../game/actions.js';
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
      if (mine && d.options.some((o) => o.ability === 'glamourweave'))
        return { title: 'Glamourweave', hint: 'Re-roll the failed roll, or keep the re-roll.' };
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
    case 'scry':
      return mine
        ? { title: 'Scry the Stars', hint: 'Pick the units that get Ward (5+).' }
        : { title: `${who} scries the stars`, hint: 'The opponent is choosing…' };
    case 'venomites':
      return mine
        ? { title: 'Venomites token', hint: 'Place the token next to the unit.' }
        : { title: `${who} places a token`, hint: 'The opponent is placing the Venomites token…' };
    case 'creepingDread':
      return mine
        ? { title: 'Creeping Dread', hint: 'Pick enemy units in the overgrowth, or pass.' }
        : { title: `${who} Creeping Dread`, hint: 'The opponent is choosing…' };
    case 'prayer':
      return mine
        ? { title: 'Prayer answered', hint: 'Use the prayer now, or bank the ritual points.' }
        : { title: `${who} chants`, hint: 'The opponent is choosing…' };
    case 'asterism':
      return mine
        ? {
            title: d.stage === 'great' ? 'The Great Plan' : 'Further the Great Plan',
            hint: 'Prophesy an Asterism.',
          }
        : { title: `${who} prophesies`, hint: 'The opponent is choosing…' };
    case 'vengeance':
      return mine
        ? {
            title: 'Vengeance of Azyr',
            hint:
              d.stage === 'pick'
                ? 'Pick up to 3 Saurus or Kroxigor units in combat, or skip.'
                : 'Pick the enemy unit to strike.',
          }
        : { title: `${who} Vengeance of Azyr`, hint: 'The opponent is choosing…' };
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
export function ReadyUnits({ label, only }: { label: string; only?: 'fight' }) {
  const state = useGameState();
  const human = useHuman();
  const ready = useMemo(
    () =>
      [...unitsOf(state, human), ...ambushUnits(state, human)].filter((u) => {
        const options = engine.unitOptions(state, u.id);
        // "Can fight" lists fighters only: a unit with just a combat ability (Rhythm of the
        // Chase) is not waiting to be picked.
        return only ? options.some((o) => o.t === only) : options.length > 0;
      }),
    [state, human, only],
  );
  if (ready.length === 0) return null;
  const choose = (id: string) => {
    const ui = useUi.getState();
    ui.select(id);
    // A unit waiting in ambush is not on the board.
    if (state.units[id]!.status === 'battlefield') {
      ui.moveCamera({ kind: 'unit', unit: id, zoom: false, onlyIfHidden: false });
    }
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

/**
 * Army commands that name a destroyed unit (The Goddess Of Life, The Land Awakens): offered
 * here so they are found without opening a particular unit's card.
 */
export function ArmyCommands() {
  const state = useGameState();
  const human = useHuman();
  const found = useMemo(() => {
    const out: { handle: string; option: Extract<UnitOption, { t: 'command' }> }[] = [];
    const seen = new Set<string>();
    for (const u of unitsOf(state, human)) {
      for (const o of engine.unitOptions(state, u.id)) {
        if (o.t !== 'command' || (o.command !== 'goddessOfLife' && o.command !== 'landAwakens'))
          continue;
        if (seen.has(o.command)) continue;
        seen.add(o.command);
        out.push({ handle: u.id, option: o });
      }
    }
    return out;
  }, [state, human]);
  if (found.length === 0) return null;
  return (
    <div className="ready" data-testid="army-commands">
      <span className="ready-label">Commands</span>
      {found.map(({ handle, option }) => {
        const names = (option.targets ?? []).map((t) => state.units[t]?.name).filter(Boolean);
        return (
          <button
            key={option.command}
            className="btn"
            data-army-command={option.command}
            onClick={() => {
              const ui = useUi.getState();
              const targets = option.targets ?? [];
              ui.setAbilityPick({
                unit: handle,
                option,
                target: targets.length === 1 ? targets[0]! : null,
              });
              if (targets.length > 0) ui.moveCamera({ kind: 'frame', units: [handle, ...targets] });
            }}
          >
            {optionLabel(handle, option)}
            {names.length > 0 && ` (${names.join(', ')})`}
          </button>
        );
      })}
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
      {mine && d.kind === 'main' && <ArmyCommands />}
      {mine && d.kind === 'main' && <ReadyUnits label="Can act" />}
      {mine && d.kind === 'fightPick' && <ReadyUnits label="Can fight" only="fight" />}
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
