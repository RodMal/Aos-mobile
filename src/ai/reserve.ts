/**
 * The NPC and reserve (M4j, I108, I109): it puts a Hunters of Huanchi unit in ambush with Hidden
 * Hunters only when it keeps a real army on the table, and brings it in with Chameleon Ambush
 * only where that helps: a legal spot at an objective it does not hold, or, in round 3 (the
 * last chance before the unit is destroyed), any legal spot. It never looks at an enemy unit in
 * reserve (it is not on the battlefield, so every plan ignores it). Cheap: nothing runs unless
 * a unit is waiting in ambush.
 */
import { CHAMELEON_AMBUSH_ID, HIDDEN_HUNTERS_ID } from '../engine/abilities/seraphon.js';
import {
  formPlacement,
  type Action,
  type Decision,
  type Engine,
  type GameState,
  type Placement,
  unitsOf,
  type PlayerId,
  type UnitState,
} from '../engine/index.js';
import { AMBUSH_DESTROYED_ROUND, ambushUnits, chameleonFrame } from '../engine/reserve.js';
import { replacementPlacement } from './replacement.js';

/** Units the army keeps on the table before it holds one back in ambush. */
const MIN_ARMY_UNITS = 4;
/** Spacing of the fallback search, in inches. */
const GRID = 4;

/** Hidden Hunters instead of deploying: one unit at a time, and only from an army of a fair size. */
export function npcHiddenHunters(
  engine: Engine,
  state: GameState,
  d: Extract<Decision, { kind: 'place' }>,
): Action | null {
  if (!d.canAmbush) return null;
  const unit = state.units[d.unit]!;
  if (engine.scenario.armies[unit.owner].units.length < MIN_ARMY_UNITS) return null;
  if (ambushUnits(state, unit.owner).length > 0) return null;
  return { t: 'ability', unit: unit.id, abilityId: HIDDEN_HUNTERS_ID };
}

/** Any legal spot, the nearest the centre of the battlefield first (the last resort). */
function anySpot(engine: Engine, state: GameState, unit: UnitState): Placement | null {
  const { width, height } = engine.scenario.battlefield;
  const spots: { x: number; y: number; k: number }[] = [];
  for (let x = GRID; x < width - GRID + 1; x += GRID) {
    for (let y = GRID; y < height - GRID + 1; y += GRID) {
      spots.push({ x, y, k: Math.hypot(x - width / 2, y - height / 2) });
    }
  }
  spots.sort((a, b) => a.k - b.k);
  const facing = unit.owner === 0 ? 0 : 180;
  for (const c of spots) {
    const p = formPlacement(engine.scenario, unit, c, facing);
    if (engine.checkPlacement(state, p).length === 0) return p;
  }
  return null;
}

/** The spot for the unit being set up by Chameleon Ambush: at a wanted objective, else (round 3) anywhere. */
export function chameleonPlacement(
  engine: Engine,
  state: GameState,
  unit: UnitState,
  anywhere = false,
): Placement | null {
  return (
    replacementPlacement(engine, state, unit) ??
    (anywhere || state.round >= AMBUSH_DESTROYED_ROUND - 1 ? anySpot(engine, state, unit) : null)
  );
}

/**
 * Movement phase: bring a unit in from ambush when it has a spot where it helps. The spot is
 * looked for on the state with the set-up frame pushed (no `apply`), and only at the start of
 * the phase, before any unit of the army has moved, so the search runs once per phase and the
 * choice depends on the state alone.
 */
export function npcChameleonAction(
  engine: Engine,
  state: GameState,
  player: PlayerId,
): Action | null {
  if (state.round < 2) return null;
  const waiting = ambushUnits(state, player);
  if (waiting.length === 0 || unitsOf(state, player).some((u) => u.moved !== null)) return null;
  for (const unit of waiting) {
    if (!engine.unitOptions(state, unit.id).some((o) => o.t === 'ability')) continue;
    const declared: GameState = { ...state, stack: [...state.stack, chameleonFrame(unit.id)] };
    if (chameleonPlacement(engine, declared, unit)) {
      return { t: 'ability', unit: unit.id, abilityId: CHAMELEON_AMBUSH_ID };
    }
  }
  return null;
}
