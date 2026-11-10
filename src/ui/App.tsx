import { useMemo } from 'react';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { createEngine, createScenario, unitFootprints } from '../engine/index.js';

/** Placeholder shell: a static picture of the deployed armies. The real board replaces it. */
export function App() {
  const { scenario, state } = useMemo(() => {
    const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
    return { scenario, state: createEngine(scenario).newGame(1) };
  }, []);
  const { battlefield } = scenario;
  return (
    <main className="shell">
      <h1>AoS Mobile</h1>
      <p>
        {scenario.armies[0].factionName} vs {scenario.armies[1].factionName} · {battlefield.name}
      </p>
      <svg
        data-testid="board"
        viewBox={`0 0 ${battlefield.height} ${battlefield.width}`}
        className="board"
      >
        {/* Portrait: the 60" axis runs down the screen. */}
        <g transform={`translate(${battlefield.height} 0) rotate(90)`}>
          <rect width={battlefield.width} height={battlefield.height} className="table" />
          {battlefield.terrain.map((t) => (
            <polygon
              key={t.id}
              points={t.polygon.map((p) => p.join(',')).join(' ')}
              className="terrain"
            />
          ))}
          {battlefield.objectives.map((o) => (
            <circle key={o.id} cx={o.x} cy={o.y} r={o.radius} className="objective" />
          ))}
          {state.unitOrder.map((id) => {
            const unit = state.units[id]!;
            return unitFootprints(scenario, unit).map((fp, i) =>
              fp.kind === 'circle' ? (
                <circle
                  key={`${id}-${i}`}
                  cx={fp.cx}
                  cy={fp.cy}
                  r={fp.r}
                  className={`p${unit.owner}`}
                />
              ) : (
                <ellipse
                  key={`${id}-${i}`}
                  cx={fp.cx}
                  cy={fp.cy}
                  rx={fp.kind === 'ellipse' ? fp.rx : fp.hw}
                  ry={fp.kind === 'ellipse' ? fp.ry : fp.hh}
                  transform={`rotate(${fp.rotation} ${fp.cx} ${fp.cy})`}
                  className={`p${unit.owner}`}
                />
              ),
            );
          })}
        </g>
      </svg>
    </main>
  );
}
