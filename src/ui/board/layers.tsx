/** The board's SVG layers, all drawn in table inches inside the view transform. */
import { memo, useMemo } from 'react';
import {
  aliveCount,
  hasVenomites,
  overgrownTokenIds,
  overgrowthReach,
  terrainFeatures,
  unitCentre,
  unitFootprints,
  unitTrunks,
  venomiteTokenAt,
  type GameState,
  type UnitState,
} from '../../engine/index.js';
import { boundingRadius, footprintPolygon, type Footprint } from '../../geom/index.js';
import { engine, scenario } from '../game/engine.js';
import { useDecision, useGameState, useHuman } from '../game/hooks.js';
import { moveOf } from '../../rules/factions/seraphon.js';
import { targetSummary } from '../game/attackPlan.js';
import { useUi } from '../game/uiStore.js';
import { fightWord } from '../game/fightStatus.js';
import { rotate, unrotate, type Rot } from './view.js';
import { declutter, estimateTextWidth } from './declutter.js';
import { Shape } from './Shape.js';

const { battlefield } = scenario;

function points(poly: readonly (readonly [number, number])[]): string {
  return poly.map((p) => `${p[0]},${p[1]}`).join(' ');
}

export function Defs() {
  return (
    <defs>
      <clipPath id="table-clip">
        <rect x={0} y={0} width={battlefield.width} height={battlefield.height} />
      </clipPath>
      <pattern
        id="hatch-enemy"
        width="0.45"
        height="0.45"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="0.45" height="0.45" className="hatch-bg" />
        <line x1="0" y1="0" x2="0" y2="0.45" className="hatch-line" />
      </pattern>
      <pattern
        id="ruin-tex"
        width="1"
        height="1"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(30)"
      >
        <rect width="1" height="1" className="ruin-bg" />
        <line x1="0" y1="0.5" x2="1" y2="0.5" className="ruin-line" />
      </pattern>
      <radialGradient id="spire-glow">
        <stop offset="0" className="spire-stop-0" />
        <stop offset="1" className="spire-stop-1" />
      </radialGradient>
    </defs>
  );
}

/** Table, grid, territories and terrain: never changes during a game. */
export const TableLayer = memo(function TableLayer({ human }: { human: 0 | 1 }) {
  const grid: number[] = [];
  for (let x = 6; x < battlefield.width; x += 6) grid.push(x);
  const gridY: number[] = [];
  for (let y = 6; y < battlefield.height; y += 6) gridY.push(y);
  return (
    <g className="layer-table">
      <rect width={battlefield.width} height={battlefield.height} className="table" />
      {([0, 1] as const).map((p) =>
        battlefield.territories[scenario.sides[p]].map((poly, i) => (
          <polygon
            key={`${p}-${i}`}
            points={points(poly)}
            className={`territory ${p === human ? 'friendly' : 'enemy'}`}
          />
        )),
      )}
      <g className="grid">
        {grid.map((x) => (
          <line key={`x${x}`} x1={x} y1={0} x2={x} y2={battlefield.height} />
        ))}
        {gridY.map((y) => (
          <line key={`y${y}`} x1={0} y1={y} x2={battlefield.width} y2={y} />
        ))}
      </g>
      {battlefield.terrain.map((t) => (
        <g key={t.id} className={`terrain terrain-${t.kind}`} data-terrain={t.kind}>
          {t.kind === 'spire' && (
            <circle cx={t.centre[0]} cy={t.centre[1]} r={4} className="spire-aura" />
          )}
          <polygon points={points(t.polygon)} />
          {t.kind === 'spire' && (
            <path
              d={`M${t.centre[0]} ${t.centre[1] - 0.9} L${t.centre[0] + 0.6} ${t.centre[1]} L${t.centre[0]} ${t.centre[1] + 0.9} L${t.centre[0] - 0.6} ${t.centre[1]} Z`}
              className="spire-mark"
            />
          )}
        </g>
      ))}
      <rect width={battlefield.width} height={battlefield.height} className="table-edge" />
    </g>
  );
});

export function ObjectivesLayer() {
  const objectives = useGameState().objectives;
  const human = useHuman();
  return (
    <g className="layer-objectives">
      {battlefield.objectives.map((o) => {
        const controller = objectives.find((s) => s.id === o.id)?.controller ?? null;
        const cls = controller === null ? 'neutral' : controller === human ? 'friendly' : 'enemy';
        return (
          <g key={o.id} className={`objective ${cls}`} data-objective={o.id}>
            <circle cx={o.x} cy={o.y} r={o.radius} className="objective-range" />
            <circle cx={o.x} cy={o.y} r={0.787} className="objective-marker" />
          </g>
        );
      })}
    </g>
  );
}

/**
 * A marker on every terrain feature that has an overgrown token (either player's). Drawn twice:
 * under the units for battlefield terrain, and over them (`onUnits`) for faction terrain, whose
 * badge would otherwise be covered by the piece.
 */
export function OvergrowthLayer({ onUnits = false }: { onUnits?: boolean }) {
  const state = useGameState();
  const human = useHuman();
  const marks: { key: string; owner: 0 | 1; x: number; y: number; outline: string[] }[] = [];
  for (const owner of [0, 1] as const) {
    const ids = new Set(overgrownTokenIds(scenario, state, owner));
    if (ids.size === 0) continue;
    for (const f of terrainFeatures(scenario, state)) {
      if (!ids.has(f.id)) continue;
      if (f.polygon && !onUnits) {
        const n = f.polygon.length;
        marks.push({
          key: `${owner}-${f.id}`,
          owner,
          x: f.polygon.reduce((a, p) => a + p[0], 0) / n,
          y: f.polygon.reduce((a, p) => a + p[1], 0) / n,
          outline: [points(f.polygon)],
        });
      } else if (f.unit && onUnits) {
        const c = unitCentre(f.unit);
        marks.push({ key: `${owner}-${f.id}`, owner, x: c.x, y: c.y, outline: [] });
      }
    }
  }
  return (
    <g className="layer-overgrowth" pointerEvents="none">
      {marks.map((m) => (
        <g
          key={m.key}
          className={`overgrown ${m.owner === human ? 'friendly' : 'enemy'}`}
          data-testid="overgrown-mark"
          data-overgrown={m.key.slice(2)}
        >
          {m.outline.map((pts, i) => (
            <polygon key={i} points={pts} className="overgrown-outline" />
          ))}
          <circle cx={m.x} cy={m.y} r={0.9} className="overgrown-badge" />
          <path
            d={`M${m.x} ${m.y + 0.5} Q${m.x - 0.7} ${m.y - 0.1} ${m.x} ${m.y - 0.6} Q${m.x + 0.7} ${m.y - 0.1} ${m.x} ${m.y + 0.5} Z`}
            className="overgrown-leaf"
          />
        </g>
      ))}
    </g>
  );
}

/** The Venomites token of every Sunblood Pack on the battlefield that still has one (R12). */
export function VenomiteTokensLayer() {
  const state = useGameState();
  const human = useHuman();
  const marks = state.unitOrder
    .map((id) => state.units[id]!)
    .filter((u) => u.status === 'battlefield' && !u.venomitesGone && hasVenomites(scenario, u));
  if (marks.length === 0) return null;
  return (
    <g className="layer-venomites" pointerEvents="none">
      {marks.map((u) => {
        const at = venomiteTokenAt(scenario, u);
        return (
          <g
            key={u.id}
            className={`venomites ${u.owner === human ? 'friendly' : 'enemy'}`}
            data-testid="venomites-token"
            data-venomites={u.id}
          >
            <circle cx={at.x} cy={at.y} r={0.7} className="venomites-badge" />
            <text x={at.x} y={at.y + 0.35} textAnchor="middle" className="venomites-glyph">
              V
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Outlines the battlefield terrain a prompt points out (The Burgeoning's candidates). */
export function FlaggedTerrainLayer() {
  const ids = useUi((s) => s.flaggedTerrain);
  if (ids.length === 0) return null;
  return (
    <g className="layer-flagged-terrain" pointerEvents="none">
      {battlefield.terrain
        .filter((t) => ids.includes(t.id))
        .map((t) => (
          <polygon
            key={t.id}
            points={points(t.polygon)}
            className="terrain-flag"
            data-testid="terrain-flag"
            data-terrain-id={t.id}
          />
        ))}
    </g>
  );
}

/**
 * Light shading of where each player's creeping overgrowth reaches: every feature with a token,
 * grown outwards by the range (a thick round-joined stroke), clipped to the table. One group per
 * player with a single opacity, so overlapping reaches do not darken.
 */
export function OvergrowthReachLayer() {
  const state = useGameState();
  const human = useHuman();
  const show = useUi((s) => s.showOvergrowth);
  if (!show) return null;
  return (
    <g className="layer-overgrowth-reach" pointerEvents="none" clipPath="url(#table-clip)">
      {([0, 1] as const).map((owner) => {
        const { range, features } = overgrowthReach(scenario, state, owner);
        if (features.length === 0) return null;
        const polys = features.flatMap((f) =>
          f.polygon
            ? [f.polygon]
            : unitFootprints(scenario, f.unit!).map((fp) => footprintPolygon(fp)),
        );
        return (
          <g
            key={owner}
            className={`overgrowth-reach ${owner === human ? 'friendly' : 'enemy'}`}
            data-testid="overgrowth-reach"
            data-owner={owner}
            data-range={range === Infinity ? 'all' : range}
          >
            {range === Infinity ? (
              <rect x={0} y={0} width={battlefield.width} height={battlefield.height} />
            ) : (
              polys.map((poly, i) => (
                <polygon key={i} points={points(poly)} strokeWidth={range * 2} />
              ))
            )}
          </g>
        );
      })}
    </g>
  );
}

function unitClasses(unit: UnitState, human: 0 | 1): string {
  return `unit p${unit.owner} ${unit.owner === human ? 'friendly' : 'enemy'}`;
}

/** Units the human could act with right now (fight picks), and attack targets. */
function useHighlights(state: GameState) {
  const decision = useDecision();
  const human = useHuman();
  const attack = useUi((s) => s.attack);
  const abilityPick = useUi((s) => s.abilityPick);
  return useMemo(() => {
    const canAct = new Set<string>();
    if (decision && decision.player === human && decision.kind === 'fightPick') {
      for (const id of state.unitOrder) {
        if (engine.unitOptions(state, id).some((o) => o.t === 'fight')) canAct.add(id);
      }
    }
    const targets = attack ? targetSummary(attack.options) : new Map<string, number>();
    const assigned = new Set(
      attack ? Object.values(attack.plan).filter((t): t is string => !!t) : [],
    );
    // An ability being aimed: its legal targets, and the one chosen so far.
    const aimed = new Set(abilityPick?.option.targets ?? []);
    if (abilityPick?.target) assigned.add(abilityPick.target);
    for (const id of abilityPick?.targets ?? []) assigned.add(id);
    return { canAct, targets, assigned, aimed };
  }, [decision, human, attack, abilityPick, state]);
}

export function UnitsLayer() {
  const state = useGameState();
  const human = useHuman();
  const selected = useUi((s) => s.selected);
  const draftUnit = useUi((s) => s.draft?.unit ?? null);
  const flagged = useUi((s) => s.flagged);
  const { canAct, targets, assigned, aimed } = useHighlights(state);
  return (
    <g className="layer-units">
      {state.unitOrder.map((id) => {
        const unit = state.units[id]!;
        if (unit.status !== 'battlefield') return null;
        const fps = unitFootprints(scenario, unit);
        const alive = unit.models.flatMap((m, i) => (m.alive ? [i] : []));
        const cls = [
          unitClasses(unit, human),
          id === selected ? 'selected' : '',
          canAct.has(id) ? 'can-act' : '',
          targets.has(id) || aimed.has(id) ? 'target' : '',
          assigned.has(id) ? 'assigned' : '',
          id === draftUnit ? 'drafting' : '',
          state.phase === 'combat' && unit.fought ? 'fought' : '',
          flagged.includes(id) ? 'flagged' : '',
        ].join(' ');
        return (
          <g key={id} data-unit-id={id} className={cls}>
            {((id === selected && id !== draftUnit) ||
              canAct.has(id) ||
              targets.has(id) ||
              aimed.has(id) ||
              flagged.includes(id)) &&
              fps.map((fp, k) => <Shape key={`h${k}`} fp={fp} grow={0.12} className="halo" />)}
            {fps.map((fp, k) => (
              <Shape key={alive[k]} fp={fp} data-model={alive[k]} className="model" />
            ))}
            {/* The Awakened Wyldwood's tree trunk: the part models cannot stand on. */}
            {unitTrunks(scenario, unit).map((fp, k) => (
              <Shape key={`t${k}`} fp={fp} className="trunk" data-testid="wyldwood-trunk" />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** Where a label sits: just past the unit's edge towards the top of the screen. */
export function labelAnchor(fps: readonly Footprint[], rot: Rot): { x: number; y: number } {
  const up = unrotate(rot, { x: 0, y: -1 });
  let cx = 0;
  let cy = 0;
  for (const f of fps) {
    cx += f.cx;
    cy += f.cy;
  }
  cx /= fps.length || 1;
  cy /= fps.length || 1;
  let reach = 0;
  for (const f of fps)
    reach = Math.max(reach, (f.cx - cx) * up.x + (f.cy - cy) * up.y + boundingRadius(f));
  return { x: cx + up.x * reach, y: cy + up.y * reach };
}

interface LabelSpec {
  id: string;
  anchor: { x: number; y: number };
  name: string;
  badge: string;
  owner: 0 | 1;
}

export function LabelsLayer({ rot }: { rot: Rot }) {
  const state = useGameState();
  const human = useHuman();
  const selected = useUi((s) => s.selected);
  const attack = useUi((s) => s.attack);
  const bucket = useUi((s) => s.zoomBucket);
  const targets = useMemo(() => (attack ? targetSummary(attack.options) : null), [attack]);
  const specs = useMemo<LabelSpec[]>(
    () =>
      state.unitOrder.flatMap((id) => {
        const unit = state.units[id]!;
        if (unit.status !== 'battlefield') return [];
        const total = unit.models.length;
        const alive = aliveCount(unit);
        const badge = [
          total > 1 ? `${alive}/${total}` : '',
          unit.damage > 0 ? `${unit.damage} dmg` : '',
          state.phase === 'combat' && unit.fought ? fightWord(state, unit) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return [
          {
            id,
            anchor: labelAnchor(unitFootprints(scenario, unit), rot),
            name: unit.name,
            badge,
            owner: unit.owner,
          },
        ];
      }),
    [state, rot],
  );
  const visible = useMemo(() => {
    const boxes = specs.map((l) => {
      const s = rotate(rot, l.anchor);
      const text = l.badge ? `${l.name}  ${l.badge}` : l.name;
      const priority =
        (l.id === selected ? 1000 : 0) +
        (targets?.has(l.id) ? 500 : 0) +
        (l.owner === human ? 50 : 0) +
        (/fought|fighting/.test(l.badge) ? 300 : 0) +
        (state.units[l.id]?.models.length ?? 0);
      return {
        key: l.id,
        x: s.x * bucket,
        y: s.y * bucket - 11,
        w: estimateTextWidth(text, 12),
        h: 15,
        priority,
      };
    });
    return declutter(boxes);
  }, [specs, rot, bucket, selected, targets, human, state]);
  return (
    <g className="layer-labels">
      {specs.map((l) => {
        if (!visible.has(l.id)) return null;
        const a = l.anchor;
        const dmg = targets?.get(l.id);
        return (
          <g
            key={l.id}
            transform={`rotate(${-rot} ${a.x} ${a.y})`}
            className={`label-group ${l.owner === human ? 'friendly' : 'enemy'} ${l.id === selected ? 'selected' : ''}`}
            data-label-for={l.id}
          >
            <text x={a.x} y={a.y} className="label" textAnchor="middle" dy="-0.45em">
              {l.name}
              {l.badge && <tspan className="badge">{`  ${l.badge}`}</tspan>}
            </text>
            {dmg !== undefined && (
              <text x={a.x} y={a.y} className="label dmg" textAnchor="middle" dy="-1.7em">
                {`≈${dmg.toFixed(1)} dmg`}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Movement and weapon reach of the selected unit. */
export function RangeLayer() {
  const state = useGameState();
  const selected = useUi((s) => s.selected);
  const drafting = useUi((s) => s.draft !== null);
  if (!selected || drafting) return null;
  const unit = state.units[selected];
  if (!unit || unit.status !== 'battlefield') return null;
  const profile = scenario.profiles[unit.profileId]!;
  const fps = unitFootprints(scenario, unit);
  const range = Math.max(
    0,
    ...profile.weapons.filter((w) => w.kind === 'ranged').map((w) => w.range),
  );
  const c = unitCentre(unit);
  return (
    <g className="layer-range" data-range-for={selected}>
      {range > 0 && (
        <g className="reach shoot">
          {fps.map((fp, k) => (
            <circle key={k} cx={fp.cx} cy={fp.cy} r={boundingRadius(fp) + range} />
          ))}
        </g>
      )}
      {profile.move > 0 && (
        <g className="reach move">
          {fps.map((fp, k) => (
            <circle
              key={k}
              cx={fp.cx}
              cy={fp.cy}
              r={boundingRadius(fp) + moveOf(scenario, state, unit)}
            />
          ))}
        </g>
      )}
      <circle cx={c.x} cy={c.y} r={0.15} className="reach-centre" />
    </g>
  );
}
