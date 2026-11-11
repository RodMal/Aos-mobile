/**
 * Using a spell, prayer, summon, ability or targeted command: what it is, its full printed
 * text, the legal targets (tap one here or on the board), and one button that rolls.
 */
import { useEffect } from 'react';
import { COMMANDS } from '../../engine/index.js';
import { optionLabel, runOption } from '../game/actions.js';
import { findAbility } from '../game/engine.js';
import { COMMAND_NAMES } from '../game/eventText.js';
import { useGameState, useHumanDecision } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { AbilityView } from '../components/AbilityView.js';

/** A line on how the roll works, for abilities with no printed text of their own. */
const HOW: Record<string, string> = {
  spell: 'Casting roll of 2D6: it is cast on the casting value or more, unless it is unbound.',
  summon:
    'Casting roll of 2D6: on the casting value or more the manifestation is set up, unless the spell is unbound.',
  prayer: 'Chanting roll of a D6, plus any ritual points you spend.',
  banish: 'Banishment roll of 2D6: the manifestation is removed on its banishment value or more.',
};

const VERB: Record<string, string> = {
  spell: 'Cast',
  summon: 'Summon',
  prayer: 'Chant',
  banish: 'Banish',
  activated: 'Use',
};

export function AbilityPanel() {
  const pick = useUi((s) => s.abilityPick);
  const setPick = useUi((s) => s.setAbilityPick);
  const state = useGameState();
  const decision = useHumanDecision();
  // The game moved on (undo, a prompt, the phase ended): the pick is stale, so close it.
  const stale = !!pick && (!decision || decision.kind !== 'main');
  useEffect(() => {
    if (stale) setPick(null);
  }, [stale, setPick]);
  // The panel is taller than the unit card, so frame the caster and targets again once the
  // sheet has settled at its new height; otherwise they end up hidden behind it.
  const sheetHeight = useUi((s) => s.sheetHeight);
  const moveCamera = useUi((s) => s.moveCamera);
  const framed = pick && !stale ? [pick.unit, ...(pick.option.targets ?? [])] : null;
  const frameKey = framed ? framed.join('|') : '';
  useEffect(() => {
    if (frameKey && sheetHeight > 0) moveCamera({ kind: 'frame', units: frameKey.split('|') });
  }, [frameKey, sheetHeight, moveCamera]);
  if (!pick || stale) return null;
  const unit = state.units[pick.unit];
  if (!unit) return null;
  const { option } = pick;
  const targets = option.targets ?? [];
  const ability = option.t === 'ability' ? findAbility(option.abilityId) : null;
  const kind = option.t === 'ability' ? option.kind : 'command';
  const needsTarget = targets.length > 0;

  // Two units with the same name get a number, in the order they stand in the army list.
  const names = targets.map((id) => state.units[id]?.name ?? id);
  const label = (id: string, k: number): string => {
    const name = names[k]!;
    if (names.filter((n) => n === name).length < 2) return name;
    const same = targets.filter((_, j) => names[j] === name);
    return `${name} ${same.indexOf(id) + 1}`;
  };

  const confirm = () => {
    if (needsTarget && !pick.target) return;
    runOption(pick.unit, option, pick.target ?? undefined);
    setPick(null);
  };

  return (
    <div className="panel ability-panel" data-testid="ability-panel">
      <header>
        <h2 className="panel-title">{optionLabel(pick.unit, option)}</h2>
        <p className="panel-hint">
          {unit.name}
          {needsTarget &&
            (pick.target ? ' · target chosen' : ' · tap a highlighted unit or a name')}
        </p>
      </header>
      <div className="ability-text">
        {ability ? (
          <AbilityView ability={ability} />
        ) : option.t === 'command' ? (
          <p>
            <strong>{COMMAND_NAMES[option.command]}.</strong> {COMMANDS[option.command].effect}
          </p>
        ) : null}
        {HOW[kind] && <p className="muted small">{HOW[kind]}</p>}
      </div>
      {needsTarget && (
        <>
          <div
            className="ready"
            data-testid="ability-targets"
            role="radiogroup"
            aria-label="Target"
          >
            {targets.map((id, k) => (
              <button
                key={id}
                role="radio"
                aria-checked={pick.target === id}
                className={`chip ${pick.target === id ? 'chosen' : ''} ${
                  state.units[id]?.owner === unit.owner ? '' : 'enemy'
                }`}
                data-target={id}
                onClick={() => setPick({ ...pick, target: id })}
              >
                {label(id, k)}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="confirm-row">
        <button className="btn" onClick={() => setPick(null)} data-testid="ability-cancel">
          Cancel
        </button>
        <button
          className="btn primary grow"
          disabled={needsTarget && !pick.target}
          onClick={confirm}
          data-testid="ability-confirm"
        >
          {VERB[kind] ?? `Use · ${option.t === 'command' ? option.cost : 0} CP`}
          {option.t === 'ability' && option.targetValue ? ` · needs ${option.targetValue}+` : ''}
        </button>
      </div>
    </div>
  );
}
