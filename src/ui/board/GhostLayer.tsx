/** The placement being edited: allowance rings, a measuring line and ghost bases. */
import { modelFootprint, moveCost, unitCentre, unitFootprints } from '../../engine/index.js';
import { scenario } from '../game/engine.js';
import { useDecision, useGameState } from '../game/hooks.js';
import { inches } from '../game/eventText.js';
import { placementCentre, setUpLimits, setUpReach } from '../game/placementEdit.js';
import { useUi } from '../game/uiStore.js';
import { Shape } from './Shape.js';
import type { Rot } from './view.js';

export function GhostLayer({ rot }: { rot: Rot }) {
  const draft = useUi((s) => s.draft);
  const state = useGameState();
  const decision = useDecision();
  if (!draft || !decision || decision.kind !== 'place') return null;
  const unit = state.units[draft.unit];
  if (!unit) return null;
  // Deployment and set-up have no distance limit (the engine stores 0 to keep plain JSON).
  const allowance =
    decision.reason === 'deploy' ||
    decision.reason === 'setUp' ||
    decision.reason === 'replacement' ||
    decision.reason === 'relocate'
      ? Infinity
      : decision.allowance;
  const bad = new Set(draft.violations.flatMap((v) => v.models ?? []));
  const reach = setUpReach(scenario, state, draft.placement);
  if (reach) return <SetUpGhost rot={rot} reach={reach} bad={bad} />;
  const limits = setUpLimits(scenario, state, draft.placement);
  const start = unitCentre(unit);
  const end = placementCentre(draft.placement);
  // Set-up has no move distance: no measuring line from where the piece was suggested.
  const dist =
    decision.reason === 'setUp' ||
    decision.reason === 'replacement' ||
    decision.reason === 'relocate'
      ? 0
      : Math.max(
          0,
          ...draft.placement.models.map((m) => moveCost(scenario, state, unit, m.i, m).total),
        );
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const tooFar = dist > allowance + 1e-6;
  const active = draft.adjust ? draft.activeModel : null;
  const activeFrom = active !== null ? unit.models[active] : undefined;
  const showZones = decision.reason === 'normal' || decision.reason === 'run';
  return (
    <g className={`layer-ghost ${draft.violations.length > 0 ? 'has-violations' : ''}`}>
      {showZones && <EnemyZones owner={unit.owner} />}
      <g className="allowance-area">
        {draft.placement.models.map((m) => {
          const from = unit.models[m.i]!;
          return <circle key={m.i} cx={from.x} cy={from.y} r={allowance} />;
        })}
      </g>
      <circle cx={start.x} cy={start.y} r={allowance} className="allowance-ring" />
      {activeFrom && (
        <circle
          cx={activeFrom.x}
          cy={activeFrom.y}
          r={allowance}
          className="allowance-ring model-ring"
        />
      )}
      {dist > 0 && (
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          className={`measure ${tooFar ? 'bad' : ''}`}
        />
      )}
      {draft.placement.models.map((m) => {
        const fp = modelFootprint(scenario, unit, m.i, m);
        return (
          <Shape
            key={m.i}
            fp={fp}
            data-ghost-model={m.i}
            className={`ghost ${bad.has(m.i) ? 'bad' : ''} ${m.i === active ? 'active' : ''}`}
          />
        );
      })}
      {limits?.nearest && (
        <g data-testid="enemy-ruler">
          <line
            x1={limits.nearest.from.x}
            y1={limits.nearest.from.y}
            x2={limits.nearest.to.x}
            y2={limits.nearest.to.y}
            className={`measure ${limits.gap > 0 && limits.nearest.dist <= limits.gap + 1e-6 ? 'bad' : ''}`}
          />
          <g
            transform={`rotate(${-rot} ${(limits.nearest.from.x + limits.nearest.to.x) / 2} ${(limits.nearest.from.y + limits.nearest.to.y) / 2})`}
          >
            <text
              x={(limits.nearest.from.x + limits.nearest.to.x) / 2}
              y={(limits.nearest.from.y + limits.nearest.to.y) / 2}
              className="label measure-label"
              textAnchor="middle"
              dy="-0.4em"
            >
              {inches(Math.round(limits.nearest.dist * 10) / 10)}
            </text>
          </g>
        </g>
      )}
      {dist > 0.05 && (
        <g transform={`rotate(${-rot} ${mid.x} ${mid.y})`}>
          <text
            x={mid.x}
            y={mid.y}
            className={`label measure-label ${tooFar ? 'bad' : ''}`}
            textAnchor="middle"
            dy="0.35em"
            data-testid="measure"
          >
            {Number.isFinite(allowance)
              ? `${inches(Math.round(dist * 10) / 10)} / ${inches(allowance)}`
              : inches(Math.round(dist * 10) / 10)}
          </text>
        </g>
      )}
    </g>
  );
}

/** The area within 3" of every enemy unit on the battlefield, shaded faintly. */
function EnemyZones({ owner }: { owner: 0 | 1 }) {
  const state = useGameState();
  const enemies = Object.values(state.units).filter(
    (u) => u.owner !== owner && u.status === 'battlefield',
  );
  return (
    <g className="enemy-zones" data-testid="enemy-zones">
      {enemies.flatMap((u) =>
        unitFootprints(scenario, u).map((fp, k) => <Shape key={`${u.id}:${k}`} fp={fp} />),
      )}
    </g>
  );
}

/**
 * A set-up wholly within range of a caster: the zone within range of the caster's bases, a
 * line from the caster to the placement and the distance from the caster.
 */
function SetUpGhost({
  rot,
  reach,
  bad,
}: {
  rot: Rot;
  reach: NonNullable<ReturnType<typeof setUpReach>>;
  bad: Set<number>;
}) {
  const draft = useUi((s) => s.draft)!;
  const state = useGameState();
  const unit = state.units[draft.unit]!;
  const casterFps = unitFootprints(scenario, reach.caster);
  const start = unitCentre(reach.caster);
  const end = placementCentre(draft.placement);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const tooFar = reach.dist > reach.range + 1e-6;
  return (
    <g
      className={`layer-ghost ${draft.violations.length > 0 ? 'has-violations' : ''}`}
      data-testid="setup-range"
    >
      <g className="allowance-area">
        {casterFps.map((fp, k) => (
          <Shape key={k} fp={fp} grow={reach.range} />
        ))}
      </g>
      {casterFps.map((fp, k) => (
        <Shape key={`r${k}`} fp={fp} grow={reach.range} className="allowance-ring" />
      ))}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        className={`measure ${tooFar ? 'bad' : ''}`}
      />
      {draft.placement.models.map((m) => (
        <Shape
          key={m.i}
          fp={modelFootprint(scenario, unit, m.i, m)}
          data-ghost-model={m.i}
          className={`ghost ${bad.has(m.i) ? 'bad' : ''}`}
        />
      ))}
      <g transform={`rotate(${-rot} ${mid.x} ${mid.y})`}>
        <text
          x={mid.x}
          y={mid.y}
          className={`label measure-label ${tooFar ? 'bad' : ''}`}
          textAnchor="middle"
          dy="0.35em"
          data-testid="measure"
        >
          {`${inches(Math.round(reach.dist * 10) / 10)} / ${inches(reach.range)}`}
        </text>
      </g>
    </g>
  );
}
