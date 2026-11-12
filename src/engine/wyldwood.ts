/**
 * Further Awakened Wyldwood pieces (owner's ruling, 2026-11-11, current Sylvaneth battletome):
 * one piece is set up at deployment; in each of the Sylvaneth player's own hero phases they may
 * set up one more piece while they have fewer than three on the battlefield.
 *
 * The warscroll text in data/factions/sylvaneth.json has no set-up rule for further pieces, so
 * the restrictions are an assumption awaiting the owner's ruling (docs/RULES-DECISIONS.md):
 * wholly on the battlefield, overlapping nothing, and more than 3" from every objective, every
 * terrain feature (including faction terrain) and every unit. Each piece is its own faction
 * terrain unit and carries its owner's overgrown token (Budding Forest).
 */
import {
  footprintDistanceToPolygon,
  footprintGapAtLeast,
  footprintInsidePolygon,
} from '../geom/index.js';
import { footprintToPoint } from '../rules/core/objectives.js';
import { boardPolygon } from './movement.js';
import { isAwakenedWyldwood } from './overgrowth.js';
import { DIST_EPS, profileOf, unitFootprints } from './query.js';
import type { Footprint } from '../geom/index.js';
import type { GameState, Placement, PlayerId, Scenario, UnitState, Violation } from './types.js';
import { baseFootprint } from '../geom/index.js';

export const WYLDWOOD_SETUP_ID = 'awakened-wyldwood-setup';
export const MAX_WYLDWOODS = 3;
/** Assumed gap from objectives, terrain features and units (awaiting the owner). */
export const WYLDWOOD_SETUP_GAP = 3;

/** Profile IDs of the three Wyldwood pieces (piece 1 is the army's own faction terrain). */
export function wyldwoodPieceProfileIds(scenario: Scenario, player: PlayerId): string[] {
  const base = scenario.armies[player].factionTerrain;
  if (!base) return [];
  return [base.id, `${base.id}:piece2`, `${base.id}:piece3`].filter(
    (id) => !!scenario.profiles[id],
  );
}

function wyldwoodsOnBattlefield(scenario: Scenario, state: GameState, player: PlayerId) {
  return state.unitOrder
    .map((id) => state.units[id]!)
    .filter(
      (u) => u.owner === player && u.status === 'battlefield' && isAwakenedWyldwood(scenario, u),
    );
}

/** True when `player` may set up another Wyldwood now (before looking for room). */
export function canSetUpWyldwood(scenario: Scenario, state: GameState, player: PlayerId): boolean {
  if (state.phase !== 'hero' || state.active !== player || state.stack.length > 0) return false;
  if (wyldwoodPieceProfileIds(scenario, player).length < MAX_WYLDWOODS) return false;
  const turnKey = `${state.round}:${state.turnIndex}`;
  if (state.players[player].wyldwoodSetUpTurn === turnKey) return false;
  return wyldwoodsOnBattlefield(scenario, state, player).length < MAX_WYLDWOODS;
}

/** The next piece to set up: a new unit (not yet in the state) using an outline not in play. */
export function nextWyldwoodPiece(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState {
  const inPlay = new Set(wyldwoodsOnBattlefield(scenario, state, player).map((u) => u.profileId));
  const ids = wyldwoodPieceProfileIds(scenario, player);
  const profileId = ids.find((id) => !inPlay.has(id)) ?? ids[0]!;
  let n = 2;
  while (state.units[`${player}:wyldwood${n}`]) n++;
  return {
    id: `${player}:wyldwood${n}`,
    owner: player,
    profileId,
    name: profileOf(scenario, { profileId } as UnitState).name,
    armyIndex: -1,
    models: [{ x: 0, y: 0, rot: 0, alive: true }],
    damage: 0,
    status: 'battlefield',
    moved: null,
    charged: false,
    shot: false,
    fought: false,
    chargeDeclared: false,
    commandUsed: null,
    allOutAttack: false,
    setUpThisTurn: true,
  };
}

interface Obstacles {
  board: ReturnType<typeof boardPolygon>;
  units: { name: string; fps: Footprint[] }[];
}

function obstaclesFor(scenario: Scenario, state: GameState, unit: UnitState): Obstacles {
  const units: Obstacles['units'] = [];
  for (const id of state.unitOrder) {
    const other = state.units[id]!;
    if (other.id === unit.id || other.status !== 'battlefield') continue;
    units.push({ name: other.name, fps: unitFootprints(scenario, other) });
  }
  return { board: boardPolygon(scenario), units };
}

function setUpViolations(
  scenario: Scenario,
  unit: UnitState,
  placement: Placement,
  obstacles: Obstacles,
  firstOnly: boolean,
): Violation[] {
  const profile = profileOf(scenario, unit);
  const m = placement.models[0];
  if (!m || placement.models.length !== 1) {
    return [{ code: 'WRONG_MODELS', message: 'Place the one terrain piece.' }];
  }
  const fp = baseFootprint(profile.models[0]!.base, m.x, m.y, m.rot);
  const out: Violation[] = [];
  if (!footprintInsidePolygon(fp, obstacles.board)) {
    out.push({
      code: 'OFF_BOARD',
      message: 'The piece must be wholly on the battlefield.',
      models: [0],
    });
    if (firstOnly) return out;
  }
  const gap = WYLDWOOD_SETUP_GAP - DIST_EPS;
  if (scenario.battlefield.objectives.some((o) => footprintToPoint(fp, o.x, o.y) <= gap)) {
    out.push({
      code: 'TOO_CLOSE',
      message: 'Set it up more than 3" from every objective.',
      models: [0],
    });
    if (firstOnly) return out;
  }
  for (const other of obstacles.units) {
    if (other.fps.some((o) => !footprintGapAtLeast(fp, o, gap))) {
      out.push({
        code: 'TOO_CLOSE',
        message: `Set it up more than 3" from every unit and terrain piece (${other.name}).`,
        models: [0],
      });
      if (firstOnly) return out;
      break;
    }
  }
  if (scenario.battlefield.terrain.some((t) => footprintDistanceToPolygon(fp, t.polygon) <= gap)) {
    out.push({
      code: 'TOO_CLOSE',
      message: 'Set it up more than 3" from every terrain feature.',
      models: [0],
    });
  }
  return out;
}

/** Violations of the (assumed) set-up rules for a Wyldwood piece at `placement`. */
export function checkWyldwoodSetUp(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  placement: Placement,
): Violation[] {
  return setUpViolations(scenario, unit, placement, obstaclesFor(scenario, state, unit), false);
}

/**
 * A legal spot for the piece, or null: the legal spot on a 2" grid closest to the nearest
 * objective (the NPC's simple choice, and the suggested start for the player). Every candidate
 * is confirmed with `checkWyldwoodSetUp`.
 */
export function suggestWyldwoodSetUp(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): Placement | null {
  const { width, height, objectives, terrain } = scenario.battlefield;
  // Model and feature centres, for a quick rejection (a heuristic: it may skip a few legal
  // spots next to a crescent's hollow, which only matters for the suggestion).
  const near: { x: number; y: number }[] = [];
  for (const id of state.unitOrder) {
    const other = state.units[id]!;
    if (other.id === unit.id || other.status !== 'battlefield') continue;
    for (const m of other.models) if (m.alive) near.push({ x: m.x, y: m.y });
  }
  for (const t of terrain) near.push({ x: t.centre[0], y: t.centre[1] });
  const spots: { x: number; y: number; key: number }[] = [];
  for (let x = 2; x <= width - 2; x += 2) {
    for (let y = 2; y <= height - 2; y += 2) {
      const key = Math.min(...objectives.map((o) => Math.hypot(o.x - x, o.y - y)));
      // The piece's centre cannot be within 3" of an objective or of a model's or feature's
      // centre: skip those without the full check.
      if (key <= WYLDWOOD_SETUP_GAP) continue;
      if (near.some((p) => Math.hypot(p.x - x, p.y - y) <= WYLDWOOD_SETUP_GAP)) continue;
      spots.push({ x, y, key });
    }
  }
  spots.sort((a, b) => a.key - b.key);
  const obstacles = obstaclesFor(scenario, state, unit);
  for (const rot of [0, 90]) {
    for (const s of spots) {
      const placement: Placement = { unit: unit.id, models: [{ i: 0, x: s.x, y: s.y, rot }] };
      if (setUpViolations(scenario, unit, placement, obstacles, true).length === 0)
        return placement;
    }
  }
  return null;
}
