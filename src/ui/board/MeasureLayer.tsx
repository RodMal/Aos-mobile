/** The measuring tool's line and distance label, drawn in table inches above the units. */
import { unitFootprints } from '../../engine/index.js';
import { measureGroups, pointFootprint, type Footprint } from '../../geom/index.js';
import { scenario } from '../game/engine.js';
import { useGameState } from '../game/hooks.js';
import { useUi, type MeasureEnd } from '../game/uiStore.js';
import type { Rot } from './view.js';

export function MeasureLayer({ rot }: { rot: Rot }) {
  const state = useGameState();
  const { on, a, b } = useUi((s) => s.measure);
  if (!on || !a) return null;
  const feet = (e: MeasureEnd): Footprint[] => {
    if (e.kind === 'point') return [pointFootprint(e.x, e.y)];
    const u = state.units[e.id];
    return u && u.status === 'battlefield' ? unitFootprints(scenario, u) : [];
  };
  const first = feet(a);
  const m = b ? measureGroups(first, feet(b)) : null;
  if (!m) {
    const f = first[0];
    if (!f) return null;
    return (
      <g className="layer-measure" data-testid="measure-start">
        <circle cx={f.cx} cy={f.cy} className="measure-dot" />
      </g>
    );
  }
  const mx = (m.a[0] + m.b[0]) / 2;
  const my = (m.a[1] + m.b[1]) / 2;
  return (
    <g className="layer-measure">
      <line x1={m.a[0]} y1={m.a[1]} x2={m.b[0]} y2={m.b[1]} className="measure-line" />
      <circle cx={m.a[0]} cy={m.a[1]} className="measure-dot" />
      <circle cx={m.b[0]} cy={m.b[1]} className="measure-dot" />
      <g transform={`rotate(${-rot} ${mx} ${my})`}>
        <text
          x={mx}
          y={my}
          className="label measure-label"
          textAnchor="middle"
          dy="-0.5em"
          data-testid="measure-readout"
          data-inches={m.gap.toFixed(2)}
        >
          {`${m.gap.toFixed(1)}"`}
        </text>
      </g>
    </g>
  );
}
