/**
 * The NPC and the Sylvaneth replacement commands (R8, I99.5, I108): The Land Awakens in its end
 * phase and The Goddess Of Life in its movement phase. It uses one only when it serves the plan
 * to win: CP in hand above its spare CP, a battle still to play, and a legal set-up spot
 * (wholly within the overgrowth, over 9" from enemies) within reach of an objective it does not
 * hold. Deterministic, and cheap: it looks at a few spots around each wanted objective, and
 * only on the rare turns a command is available. A unit already replaced is never a target
 * (Core 24.2): the engine's eligibility lists leave it out.
 */
import {
  controlScores,
  formPlacement,
  profileOf,
  unitCentre,
  type Action,
  type Decision,
  type Engine,
  type GameState,
  type Placement,
  type PlayerId,
  type UnitOption,
  type UnitState,
} from '../engine/index.js';
import { goddessOfLifeUnits, landAwakensTargets } from '../engine/eligibility.js';

/** CP the NPC keeps in hand before it spends on optional commands (as in `baseline.ts`). */
const SPARE_CP = 2;
/** A spot this close to an objective (centre to unit centre, plus its radius) contests it. */
const REACH = 3;

type CommandOption = Extract<UnitOption, { t: 'command' }>;

/** Objectives `player` does not hold with a model of its own on them, nearest first. */
function wantedObjectives(engine: Engine, state: GameState, player: PlayerId, from: UnitState) {
  const scores = controlScores(engine.scenario, state);
  const c = unitCentre(from);
  return engine.scenario.battlefield.objectives
    .filter((o) => {
      const controller = state.objectives.find((x) => x.id === o.id)!.controller;
      const [a, b] = scores.get(o.id)!;
      return controller !== player || (player === 0 ? a : b) === 0;
    })
    .sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y));
}

/**
 * A legal set-up for the unit being placed, at the first wanted objective that has one: the
 * spot nearest the objective's centre. Null if there is none.
 */
export function replacementPlacement(
  engine: Engine,
  state: GameState,
  unit: UnitState,
): Placement | null {
  const radii = [0, 2, 4, 6, 8];
  for (const o of wantedObjectives(engine, state, unit.owner, unit)) {
    for (const r of radii) {
      if (r > o.radius + REACH) break;
      for (let a = 0; a < (r === 0 ? 1 : 360); a += 45) {
        const centre = {
          x: o.x + Math.cos((a * Math.PI) / 180) * r,
          y: o.y + Math.sin((a * Math.PI) / 180) * r,
        };
        const facing = (Math.atan2(o.y - centre.y, o.x - centre.x) * 180) / Math.PI;
        const p = formPlacement(engine.scenario, unit, centre, facing);
        if (engine.checkPlacement(state, p).length === 0) return p;
      }
    }
  }
  return null;
}

/**
 * The command to take now, or null. `phase` is the NPC's own: movement for The Goddess Of Life
 * (Alarielle, once she is destroyed), end for The Land Awakens (the destroyed unit worth the
 * most points; more models first on a tie).
 */
export function replacementAction(
  engine: Engine,
  state: GameState,
  player: PlayerId,
  phase: GameState['phase'],
): Action | null {
  const command = phase === 'movement' ? 'goddessOfLife' : phase === 'end' ? 'landAwakens' : null;
  if (!command || state.players[player].cp < SPARE_CP) return null;
  // Nothing left to win once the battle is in its last turn.
  if (state.round >= engine.scenario.rounds && player !== state.firstPlayer) return null;
  // Cheap pre-check: nothing to bring back, nothing to do.
  const eligible =
    command === 'goddessOfLife'
      ? goddessOfLifeUnits(engine.scenario, state, player)
      : landAwakensTargets(engine.scenario, state, player);
  if (eligible.length === 0) return null;
  for (const unit of state.unitOrder.map((id) => state.units[id]!)) {
    if (unit.owner !== player || unit.status !== 'battlefield') continue;
    const opt = engine
      .unitOptions(state, unit.id)
      .find((o): o is CommandOption => o.t === 'command' && o.command === command);
    if (!opt?.targets || opt.targets.length === 0) continue;
    const worth = (id: string): number => {
      const u = state.units[id]!;
      return profileOf(engine.scenario, u).points * 1000 + u.models.length;
    };
    const target = [...opt.targets].sort((x, y) => worth(y) - worth(x) || (x < y ? -1 : 1))[0]!;
    const action: Action = { t: 'command', command, unit: unit.id, target };
    // Try it: use it only if the unit can be set up where it helps.
    const declared = engine.apply(state, action).state;
    const d: Decision | null = engine.decision(declared);
    if (d?.kind !== 'place' || d.reason !== 'replacement') continue;
    if (replacementPlacement(engine, declared, declared.units[d.unit]!)) return action;
    return null;
  }
  return null;
}
