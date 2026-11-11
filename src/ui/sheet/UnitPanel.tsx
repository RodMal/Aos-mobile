/** A selected unit: compact card, actions from the engine, and the expandable warscroll. */
import { useMemo, useState } from 'react';
import type { GameState, UnitOption } from '../../engine/index.js';
import { engine, playerName } from '../game/engine.js';
import { endPhase, optionLabel, phaseName, runOption } from '../game/actions.js';
import { useGameState, useHuman, useHumanDecision } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Icon } from '../components/Icon.js';
import { FullCard, StatLine } from '../components/UnitCard.js';
import { ReadyUnits } from './DecisionPanel.js';

export function UnitPanel({ unitId }: { unitId: string }) {
  const state = useGameState();
  const human = useHuman();
  const decision = useHumanDecision();
  const expanded = useUi((s) => s.sheetExpanded);
  const setExpanded = useUi((s) => s.setSheetExpanded);
  const select = useUi((s) => s.select);
  const [pending, setPending] = useState<{
    unitId: string;
    state: GameState;
    option: UnitOption;
  } | null>(null);
  const unit = state.units[unitId];
  const options = useMemo(
    () => (decision ? engine.unitOptions(state, unitId) : []),
    [decision, state, unitId],
  );
  if (!unit) return null;
  const mine = unit.owner === human;
  const pendingOption =
    pending && pending.unitId === unitId && pending.state === state ? pending.option : null;
  const pendingTargets =
    pendingOption?.t === 'ability'
      ? pendingOption.targets
      : pendingOption?.t === 'command'
        ? (pendingOption.targets ?? [])
        : [];
  const effects = state.effects?.filter((e) => e.targetUnit === unit.id) ?? [];
  const ritualPoints = unit.ritualPoints ?? 0;
  const status =
    unit.status !== 'battlefield'
      ? unit.status === 'destroyed'
        ? 'Destroyed'
        : 'In reserve'
      : [
          unit.moved &&
            `${unit.moved === 'normal' ? 'moved' : unit.moved === 'run' ? 'ran' : 'retreated'}`,
          unit.charged && 'charged',
          unit.shot && 'shot',
          unit.fought && 'fought',
        ]
          .filter(Boolean)
          .join(' · ');
  return (
    <div className="panel unit-panel" data-testid="unit-panel" data-unit={unitId}>
      <header className="unit-head">
        <span className={`side-mark ${mine ? 'friendly' : 'enemy'}`} aria-hidden="true" />
        <div className="unit-title">
          <h2 className="panel-title" data-testid="unit-name">
            {unit.name}
          </h2>
          <p className="panel-hint">
            {mine ? 'Yours' : playerName(unit.owner)}
            {status ? ` · ${status}` : ''}
          </p>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}>
          <Icon name="close" />
        </button>
      </header>
      <StatLine unit={unit} />
      {(ritualPoints > 0 || effects.length > 0) && (
        <div className="ready" data-testid="unit-effects">
          {ritualPoints > 0 && <span className="chip">Ritual {ritualPoints}</span>}
          {effects.map((eff, i) => (
            <span key={`${eff.id}-${i}`} className="chip">
              {eff.name}
            </span>
          ))}
        </div>
      )}
      {mine && options.length > 0 && (
        <div className="actions" data-testid="unit-actions">
          {pendingOption && pendingTargets.length > 1 ? (
            <>
              {pendingTargets.map((targetId, k) => (
                <button
                  key={targetId}
                  className={`btn ${k === 0 ? 'primary' : ''}`}
                  onClick={() => {
                    runOption(unitId, pendingOption, targetId);
                    setPending(null);
                  }}
                  data-target={targetId}
                >
                  {state.units[targetId]?.name ?? targetId}
                </button>
              ))}
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
            </>
          ) : (
            options.map((o, k) => {
              const multiTarget =
                (o.t === 'ability' && o.targets.length > 1) ||
                (o.t === 'command' && (o.targets?.length ?? 0) > 1);
              return (
                <button
                  key={k}
                  className={`btn ${k === 0 ? 'primary' : ''}`}
                  onClick={() => {
                    if (multiTarget) setPending({ unitId, state, option: o });
                    else runOption(unitId, o);
                  }}
                  data-action={o.t === 'move' ? o.kind : o.t}
                >
                  {optionLabel(unitId, o)}
                </button>
              );
            })
          )}
        </div>
      )}
      {/* This unit has nothing to do: point at the ones that do, so the prompt is not hidden. */}
      {options.length === 0 && (decision?.kind === 'main' || decision?.kind === 'fightPick') && (
        <ReadyUnits label={decision.kind === 'fightPick' ? 'Can fight' : 'Can act'} />
      )}
      {options.length === 0 && decision?.kind === 'main' && (
        <button className="btn primary wide" onClick={endPhase} data-testid="end-phase">
          End {phaseName(decision.phase).toLowerCase()} phase
        </button>
      )}
      <button
        className="btn ghost-btn wide details-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        data-testid="details-toggle"
      >
        {expanded ? 'Hide warscroll' : 'Warscroll and abilities'}
        <span className={`chev ${expanded ? 'up' : ''}`}>
          <Icon name="chevron" size={18} />
        </span>
      </button>
      {expanded && <FullCard unit={unit} />}
    </div>
  );
}
