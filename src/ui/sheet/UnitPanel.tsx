/** A selected unit: compact card, actions from the engine, and the expandable warscroll. */
import { useMemo } from 'react';
import { engine, playerName } from '../game/engine.js';
import { endPhase, optionLabel, phaseName, runOption } from '../game/actions.js';
import { useGameState, useHuman, useHumanDecision } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { fightWord } from '../game/fightStatus.js';
import { WYLDWOOD_OUTLINES } from '../../data/wyldwood.js';
import { Icon } from '../components/Icon.js';
import { FullCard, StatLine } from '../components/UnitCard.js';
import { ReadyUnits } from './DecisionPanel.js';

/** A small silhouette of a Wyldwood crescent piece, for choosing which to set up. */
function PieceShape({ piece }: { piece: number }) {
  const pts = WYLDWOOD_OUTLINES[piece - 1];
  if (!pts) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  return (
    <svg
      className="piece-shape"
      data-testid="piece-shape"
      width={24}
      height={24}
      viewBox={`${x0} ${y0} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ marginRight: 8, verticalAlign: 'middle' }}
    >
      <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="currentColor" />
    </svg>
  );
}

export function UnitPanel({ unitId }: { unitId: string }) {
  const state = useGameState();
  const human = useHuman();
  const decision = useHumanDecision();
  const expanded = useUi((s) => s.sheetExpanded);
  const setExpanded = useUi((s) => s.setSheetExpanded);
  const select = useUi((s) => s.select);
  const setAbilityPick = useUi((s) => s.setAbilityPick);
  const moveCamera = useUi((s) => s.moveCamera);
  const unit = state.units[unitId];
  const options = useMemo(
    () => (decision ? engine.unitOptions(state, unitId) : []),
    [decision, state, unitId],
  );
  if (!unit) return null;
  const mine = unit.owner === human;
  const effects = state.effects?.filter((e) => e.targetUnit === unit.id) ?? [];
  const ritualPoints = unit.ritualPoints ?? 0;
  const status =
    unit.status !== 'battlefield'
      ? unit.status === 'destroyed'
        ? 'Destroyed'
        : unit.inAmbush
          ? 'In reserve in ambush'
          : 'In reserve'
      : [
          unit.moved &&
            `${unit.moved === 'normal' ? 'moved' : unit.moved === 'run' ? 'ran' : 'retreated'}`,
          unit.charged && 'charged',
          unit.shot && 'shot',
          fightWord(state, unit) || false,
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
          {options.map((o, k) => (
            <button
              key={k}
              className={`btn ${k === 0 ? 'primary' : ''}`}
              onClick={() => {
                // Abilities and targeted commands open a panel with their text and targets;
                // everything else acts at once.
                if (o.t === 'ability' || (o.t === 'command' && (o.targets?.length ?? 0) > 0)) {
                  const targets = o.targets ?? [];
                  setAbilityPick({
                    unit: unitId,
                    option: o,
                    target: targets.length === 1 ? targets[0]! : null,
                  });
                  if (targets.length > 0)
                    moveCamera({ kind: 'frame', units: [unitId, ...targets] });
                } else runOption(unitId, o);
              }}
              data-action={o.t === 'move' ? o.kind : o.t}
              data-ability={o.t === 'ability' ? o.abilityId : undefined}
            >
              {o.t === 'ability' && o.abilityId === 'awakened-wyldwood-setup' && o.choice && (
                <PieceShape piece={Number(o.choice)} />
              )}
              {optionLabel(unitId, o)}
            </button>
          ))}
        </div>
      )}
      {/* This unit has nothing to do: point at the ones that do, so the prompt is not hidden. */}
      {options.length === 0 && (decision?.kind === 'main' || decision?.kind === 'fightPick') && (
        <ReadyUnits
          label={decision.kind === 'fightPick' ? 'Can fight' : 'Can act'}
          only={decision.kind === 'fightPick' ? 'fight' : undefined}
        />
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
