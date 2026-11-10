/** The placement being edited: allowance rings, a measuring line and ghost bases. */
import { modelFootprint, unitCentre } from '../../engine/index.js';
import { scenario } from '../game/engine.js';
import { useDecision, useGameState } from '../game/hooks.js';
import { inches } from '../game/eventText.js';
import { maxDistance, placementCentre } from '../game/placementEdit.js';
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
  const allowance = decision.allowance;
  const bad = new Set(draft.violations.flatMap((v) => v.models ?? []));
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
            {`${inches(Math.round(dist * 10) / 10)} / ${inches(allowance)}`}
          </text>
        </g>
      )}
    </g>
  );
}
