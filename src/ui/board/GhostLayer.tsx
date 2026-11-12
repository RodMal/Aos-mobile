/** The placement being edited: allowance rings, a measuring line and ghost bases. */
import { modelFootprint, unitCentre, unitFootprints } from '../../engine/index.js';
import { scenario } from '../game/engine.js';
import { useDecision, useGameState } from '../game/hooks.js';
import { inches } from '../game/eventText.js';
import { maxDistance, placementCentre, setUpReach } from '../game/placementEdit.js';
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
    decision.reason === 'deploy' || decision.reason === 'setUp' ? Infinity : decision.allowance;
  const bad = new Set(draft.violations.flatMap((v) => v.models ?? []));
  const reach = setUpReach(scenario, state, draft.placement);
  if (reach) return <SetUpGhost rot={rot} reach={reach} bad={bad} />;
  const start = unitCentre(unit);
  const end = placementCentre(draft.placement);
  const dist = maxDistance(unit, draft.placement);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const tooFar = dist > allowance + 1e-6;
  const active = draft.adjust ? draft.activeModel : null;
  const activeFrom = active !== null ? unit.models[active] : undefined;
  return (
    <g className={`layer-ghost ${draft.violations.length > 0 ? 'has-violations' : ''}`}>
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
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        className={`measure ${tooFar ? 'bad' : ''}`}
      />
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
