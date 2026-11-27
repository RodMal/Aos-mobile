/**
 * Further Awakened Wyldwood pieces (owner's ruling, 2026-11-11, current Sylvaneth battletome):
 * one piece is set up at deployment; in each of the Sylvaneth player's own hero phases they may
 * set up one more piece while they have fewer than three on the battlefield.
 *
 * Reclaimed By Nature (printed, data/factions/sylvaneth.json; confirmed by the owner,
 * 2026-11-12): wholly on the battlefield, more than 3" from all objectives (from the marker's
 * edge) and enemy units, more than 12" from all other friendly Awakened Wyldwoods and more than
 * 1" from all other terrain features (faction terrain included), every distance edge to edge
 * from the piece's outline. It may not overlap a friendly unit. Each piece is its own faction
 * terrain unit and carries its owner's overgrown token (Budding Forest).
 */
import {
  footprintDistanceToPolygon,
  footprintGapAtLeast,
  footprintInsidePolygon,
  footprintsOverlap,
} from '../geom/index.js';
import { footprintToPoint } from '../rules/core/objectives.js';
import { TRUNK_INSET } from '../data/wyldwood.js';
import { boardPolygon } from './movement.js';
import { isAwakenedWyldwood } from './overgrowth.js';
import { DIST_EPS, isFactionTerrainUnit, profileOf, unitFootprints } from './query.js';
import type { Footprint } from '../geom/index.js';
import type { GameState, Placement, PlayerId, Scenario, UnitState, Violation } from './types.js';
import { baseFootprint } from '../geom/index.js';

export const WYLDWOOD_SETUP_ID = 'awakened-wyldwood-setup';
export const MAX_WYLDWOODS = 3;

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

/** The pieces (numbered 1 to 3) whose outline is not on the battlefield, in numeric order. */
export function remainingWyldwoodPieces(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): { piece: number; profileId: string; length: number; width: number }[] {
  const inPlay = new Set(wyldwoodsOnBattlefield(scenario, state, player).map((u) => u.profileId));
  return wyldwoodPieceProfileIds(scenario, player)
    .map((profileId, i) => ({ profileId, piece: i + 1 }))
    .filter((p) => !inPlay.has(p.profileId))
    .map((p) => ({ ...p, ...pieceSize(scenario, p.profileId) }));
}

/** Tip-to-tip length and widest width (twice the largest inscribed circle), to 0.1". */
function pieceSize(scenario: Scenario, profileId: string): { length: number; width: number } {
  const base = scenario.profiles[profileId]?.models[0]?.base;
  if (!base || base.kind !== 'outline') return { length: 0, width: 0 };
  let length = 0;
  for (const a of base.points)
    for (const b of base.points) length = Math.max(length, Math.hypot(a[0] - b[0], a[1] - b[1]));
  const width = base.trunk ? (2 * base.trunk.r) / TRUNK_INSET : 0;
  const tenth = (n: number) => Math.round(n * 10) / 10;
  return { length: tenth(length), width: tenth(width) };
}

/**
 * The next piece to set up: a new unit (not yet in the state) using an outline not in play.
 * `piece` (1 to 3) picks the outline; without it, the lowest-numbered one left.
 */
export function nextWyldwoodPiece(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  piece?: number,
): UnitState {
  const left = remainingWyldwoodPieces(scenario, state, player);
  const ids = wyldwoodPieceProfileIds(scenario, player);
  const profileId =
    (piece !== undefined ? left.find((p) => p.piece === piece)?.profileId : left[0]?.profileId) ??
    ids[0]!;
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

/** Radius of a 40mm objective marker: distances to objectives are measured from its edge (I1). */
export const OBJECTIVE_MARKER_RADIUS = 0.787;
/** Reclaimed By Nature (printed): gaps from objectives and enemy units, other Wyldwoods, terrain. */
export const WYLDWOOD_GAP_OBJECTIVE = 3;
export const WYLDWOOD_GAP_ENEMY = 3;
export const WYLDWOOD_GAP_WYLDWOOD = 12;
export const WYLDWOOD_GAP_TERRAIN = 1;

interface Obstacle {
  name: string;
  fps: Footprint[];
}

interface Obstacles {
  board: ReturnType<typeof boardPolygon>;
  /** Enemy units (not faction terrain): more than 3". */
  enemies: Obstacle[];
  /** Other friendly Awakened Wyldwoods: more than 12". */
  wyldwoods: Obstacle[];
  /** Other faction terrain (either army): a terrain feature, more than 1". */
  factionTerrain: Obstacle[];
  /** Friendly units: the piece may not overlap them. */
  friends: Obstacle[];
}

function obstaclesFor(scenario: Scenario, state: GameState, unit: UnitState): Obstacles {
  const o: Obstacles = {
    board: boardPolygon(scenario),
    enemies: [],
    wyldwoods: [],
    factionTerrain: [],
    friends: [],
  };
  for (const id of state.unitOrder) {
    const other = state.units[id]!;
    if (other.id === unit.id || other.status !== 'battlefield') continue;
    const entry = { name: other.name, fps: unitFootprints(scenario, other) };
    if (other.owner === unit.owner && isAwakenedWyldwood(scenario, other)) o.wyldwoods.push(entry);
    else if (isFactionTerrainUnit(scenario, other)) o.factionTerrain.push(entry);
    else if (other.owner !== unit.owner) o.enemies.push(entry);
    else o.friends.push(entry);
  }
  return o;
}

const near = (fp: Footprint, list: Obstacle[], gap: number) =>
  list.find((other) => other.fps.some((o) => !footprintGapAtLeast(fp, o, gap - DIST_EPS)));

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
  const add = (message: string) => {
    out.push({ code: 'TOO_CLOSE', message, models: [0] });
    return firstOnly;
  };
  if (!footprintInsidePolygon(fp, obstacles.board)) {
    out.push({
      code: 'OFF_BOARD',
      message: 'The piece must be wholly on the battlefield.',
      models: [0],
    });
    if (firstOnly) return out;
  }
  const obj = scenario.battlefield.objectives.find(
    (o) =>
      footprintToPoint(fp, o.x, o.y) - OBJECTIVE_MARKER_RADIUS <= WYLDWOOD_GAP_OBJECTIVE - DIST_EPS,
  );
  if (obj && add('Set it up more than 3" from every objective (measured from the marker’s edge).'))
    return out;
  const enemy = near(fp, obstacles.enemies, WYLDWOOD_GAP_ENEMY);
  if (enemy && add(`Set it up more than 3" from every enemy unit (${enemy.name}).`)) return out;
  const wood = near(fp, obstacles.wyldwoods, WYLDWOOD_GAP_WYLDWOOD);
  if (wood && add('Set it up more than 12" from every other friendly Awakened Wyldwood.'))
    return out;
  const terrainHit =
    scenario.battlefield.terrain.some(
      (t) => footprintDistanceToPolygon(fp, t.polygon) <= WYLDWOOD_GAP_TERRAIN - DIST_EPS,
    ) || !!near(fp, obstacles.factionTerrain, WYLDWOOD_GAP_TERRAIN);
  if (terrainHit && add('Set it up more than 1" from every other terrain feature.')) return out;
  const friend = obstacles.friends.find((f) => f.fps.some((o) => footprintsOverlap(fp, o)));
  if (friend) add(`The piece cannot overlap ${friend.name}.`);
  return out;
}

/** Violations of Reclaimed By Nature's set-up rules for a Wyldwood piece at `placement`. */
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
  const centres: { x: number; y: number; r: number }[] = [];
  for (const id of state.unitOrder) {
    const other = state.units[id]!;
    if (other.id === unit.id || other.status !== 'battlefield') continue;
    const r =
      other.owner === unit.owner && isAwakenedWyldwood(scenario, other)
        ? WYLDWOOD_GAP_WYLDWOOD
        : other.owner !== unit.owner && !isFactionTerrainUnit(scenario, other)
          ? WYLDWOOD_GAP_ENEMY
          : 0.5;
    for (const m of other.models) if (m.alive) centres.push({ x: m.x, y: m.y, r });
  }
  for (const t of terrain) centres.push({ x: t.centre[0], y: t.centre[1], r: 0.5 });
  const spots: { x: number; y: number; key: number }[] = [];
  for (let x = 2; x <= width - 2; x += 2) {
    for (let y = 2; y <= height - 2; y += 2) {
      const key = Math.min(...objectives.map((o) => Math.hypot(o.x - x, o.y - y)));
      // The piece's centre cannot be that close to an objective or to a model's or feature's
      // centre: skip those without the full check.
      if (key <= WYLDWOOD_GAP_OBJECTIVE + OBJECTIVE_MARKER_RADIUS) continue;
      if (centres.some((p) => Math.hypot(p.x - x, p.y - y) <= p.r)) continue;
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
