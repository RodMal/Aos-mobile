/**
 * Alternating deployment phase (GHB 2026-27 "Into the Fire", Core Rules 10.0):
 * - Units and faction terrain start in `status: 'reserve'`.
 * - Faction terrain is set up first (attacker then defender), then players alternate
 *   setting up one regiment at a time until all units are deployed.
 */
import {
  baseFootprint,
  checkCoherencyFootprints,
  footprintDistanceToPolygon,
  footprintGap,
  footprintInsidePolygon,
  footprintOverlapsPolygon,
  footprintsOverlap,
  layoutFormation,
  pointInPolygon,
  type Footprint,
  type Polygon,
} from '../geom/index.js';
import { boardPolygon } from './movement.js';
import { allowsSetUpOn } from '../data/battlefield.js';
import {
  aliveIndices,
  attackerOf,
  defaultFrontage,
  DIST_EPS,
  facingTowards,
  formPlacement,
  modelFootprint,
  opponent,
  profileOf,
  unitFootprints,
  unitsOf,
} from './query.js';
import type {
  Frame,
  GameState,
  ModelState,
  Placement,
  PlayerId,
  Scenario,
  UnitId,
  UnitState,
  Violation,
} from './types.js';

function polygonCentroid(polys: readonly Polygon[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const poly of polys) {
    for (const p of poly) {
      x += p[0];
      y += p[1];
      n++;
    }
  }
  return n === 0 ? { x: 0, y: 0 } : { x: x / n, y: y / n };
}

function initialModelsAt(
  bases: readonly { kind: string }[],
  centre: { x: number; y: number },
  facing: number,
): ModelState[] {
  const frontage = defaultFrontage(bases.length);
  const tokens = layoutFormation(
    bases as Parameters<typeof layoutFormation>[0],
    frontage,
    [centre.x, centre.y],
    facing,
  );
  const models: ModelState[] = [];
  for (const t of tokens) {
    models[t.modelIndex] = { x: t.x, y: t.y, rot: t.rotation, alive: true };
  }
  return models;
}

/**
 * Creates all `UnitState`s for both armies (`[0, 1]`), plus each army's `factionTerrain`
 * (if non-null, with `id: "${player}:terrain"`, `armyIndex: -1`) in `status: 'reserve'`,
 * with initial model coordinates positioned around their home territory centroid.
 */
export function createReserveUnits(scenario: Scenario): UnitState[] {
  const { battlefield } = scenario;
  const boardCentre = { x: battlefield.width / 2, y: battlefield.height / 2 };
  const units: UnitState[] = [];

  for (const player of [0, 1] as PlayerId[]) {
    const own = battlefield.territories[scenario.sides[player]];
    const home = polygonCentroid(own);
    const facing = facingTowards(home, boardCentre);
    const army = scenario.armies[player];

    if (army.factionTerrain) {
      const terrainProfile = army.factionTerrain;
      const bases = terrainProfile.models.map((m) => m.base);
      units.push({
        id: `${player}:terrain`,
        owner: player,
        profileId: terrainProfile.id,
        name: terrainProfile.name,
        armyIndex: -1,
        models: initialModelsAt(bases, home, facing),
        damage: 0,
        status: 'reserve',
        moved: null,
        charged: false,
        shot: false,
        fought: false,
        chargeDeclared: false,
        commandUsed: null,
        allOutAttack: false,
      });
    }

    for (const armyUnit of army.units) {
      const bases = armyUnit.profile.models.map((m) => m.base);
      units.push({
        id: `${player}:${armyUnit.index}`,
        owner: player,
        profileId: armyUnit.profile.id,
        name: armyUnit.profile.name,
        armyIndex: armyUnit.index,
        models: initialModelsAt(bases, home, facing),
        damage: 0,
        status: 'reserve',
        moved: null,
        charged: false,
        shot: false,
        fought: false,
        chargeDeclared: false,
        commandUsed: null,
        allOutAttack: false,
      });
    }
  }

  return units.sort((a, b) => a.owner - b.owner || a.armyIndex - b.armyIndex);
}

/**
 * Builds the LIFO stack of `'deploy'` placement frames:
 * - Attacker (`player 0`) deploys first (`firstToDeploy: 'attacker'`).
 * - Faction terrain is set up before units (`P0 terrain`, then `P1 terrain`).
 * - Then regiments alternate (`P0 reg 0`, `P1 reg 0`, `P0 reg 1`, `P1 reg 1`, ...),
 *   with remaining regiments deployed once the other player finishes (`remainingDeployAtOnce: true`).
 * - Within each regiment, units are ordered largest-first (ties broken by `armyIndex`).
 * - Returned in stack order so popping from the end of `stack` visits units in deployment order.
 */
export function buildDeploymentFrames(
  scenario: Scenario,
  units: Record<UnitId, UnitState>,
): Frame[] {
  const allReserve = Object.values(units).filter((u) => u.status === 'reserve');
  const deployOrder: UnitState[] = [];

  const attacker = attackerOf(scenario);
  const order: PlayerId[] = [attacker, attacker === 0 ? 1 : 0];
  // 1. Faction terrain: the attacker first, then the defender.
  for (const player of order) {
    const terrains = allReserve
      .filter((u) => u.owner === player && profileOf(scenario, u).isFactionTerrain)
      .sort((a, b) => a.armyIndex - b.armyIndex);
    deployOrder.push(...terrains);
  }

  // 2. Group each player's non-terrain units by regiment in ascending regiment order.
  const regimentsByPlayer: [UnitState[][], UnitState[][]] = [[], []];
  for (const player of [0, 1] as PlayerId[]) {
    const playerUnits = allReserve.filter(
      (u) => u.owner === player && !profileOf(scenario, u).isFactionTerrain,
    );
    const byReg = new Map<number, UnitState[]>();
    for (const u of playerUnits) {
      const reg = scenario.armies[player].units[u.armyIndex]?.regiment ?? 0;
      const list = byReg.get(reg) ?? [];
      list.push(u);
      byReg.set(reg, list);
    }
    const sortedRegNums = [...byReg.keys()].sort((a, b) => a - b);
    regimentsByPlayer[player] = sortedRegNums.map((reg) =>
      byReg
        .get(reg)!
        .sort((a, b) => b.models.length - a.models.length || a.armyIndex - b.armyIndex),
    );
  }

  // 3. Alternate regiments starting with the attacker.
  const maxRegiments = Math.max(regimentsByPlayer[0].length, regimentsByPlayer[1].length);
  for (let r = 0; r < maxRegiments; r++) {
    for (const player of order) {
      const regUnits = regimentsByPlayer[player][r];
      if (regUnits) {
        deployOrder.push(...regUnits);
      }
    }
  }

  const frames: Frame[] = deployOrder.map((u) => ({
    t: 'place',
    unit: u.id,
    reason: 'deploy',
    // Deployment has no distance limit; 0 keeps the state plain JSON (Infinity turns into null).
    allowance: 0,
    dice: [],
  }));

  // Reverse so that top-of-stack (`stack[stack.length - 1]`) is the first unit to deploy.
  return frames.reverse();
}

function footprintToPoint(fp: Footprint, x: number, y: number): number {
  return footprintGap(fp, { kind: 'circle', cx: x, cy: y, r: 0 });
}

/**
 * Validates a `'deploy'` placement for `unit`:
 * - Every living model placed once (`WRONG_MODELS`).
 * - Every model on the board (`OFF_BOARD`).
 * - Every model wholly inside `own` territory polygons (`OUTSIDE_TERRITORY`).
 * - Every model at least `minGap` (3" for faction terrain, 9" for units) from `enemy` territory (`TOO_CLOSE_TO_ENEMY_TERRITORY`).
 * - Faction terrain cannot be within 3" of objectives or overlap terrain features (`OVERLAP`).
 * - No model overlaps any terrain feature, already-deployed unit, or model in the same unit (`OVERLAP`).
 * - Coherency holds (`COHERENCY`).
 */
export function checkDeployPlacement(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  placement: Placement,
): Violation[] {
  const violations: Violation[] = [];
  const alive = aliveIndices(unit);
  const placedIds = placement.models.map((m) => m.i).sort((a, b) => a - b);
  if (
    placement.unit !== unit.id ||
    placedIds.length !== alive.length ||
    placedIds.some((i, k) => i !== alive[k])
  ) {
    return [{ code: 'WRONG_MODELS', message: 'Every living model must be placed exactly once.' }];
  }

  const board = boardPolygon(scenario);
  const ends = new Map<number, Footprint>();
  for (const m of placement.models) ends.set(m.i, modelFootprint(scenario, unit, m.i, m));

  const offBoard = placement.models
    .filter((m) => !footprintInsidePolygon(ends.get(m.i)!, board))
    .map((m) => m.i);
  if (offBoard.length > 0) {
    violations.push({
      code: 'OFF_BOARD',
      message: 'Models must stay on the battlefield.',
      models: offBoard,
    });
  }

  const { battlefield } = scenario;
  const own = battlefield.territories[scenario.sides[unit.owner]];
  const enemy = battlefield.territories[scenario.sides[opponent(unit.owner)]];
  const isTerrain = profileOf(scenario, unit).isFactionTerrain;

  const outsideTerritory = placement.models
    .filter((m) => !own.some((poly) => footprintInsidePolygon(ends.get(m.i)!, poly)))
    .map((m) => m.i);
  if (outsideTerritory.length > 0) {
    violations.push({
      code: 'OUTSIDE_TERRITORY',
      message: 'Models must be set up wholly within your territory.',
      models: outsideTerritory,
    });
  }

  const minGap = isTerrain ? 3 : battlefield.deployGapFromEnemyTerritory;
  const tooCloseToEnemy = placement.models
    .filter((m) =>
      enemy.some((poly) => footprintDistanceToPolygon(ends.get(m.i)!, poly) + DIST_EPS < minGap),
    )
    .map((m) => m.i);
  if (tooCloseToEnemy.length > 0) {
    violations.push({
      code: 'TOO_CLOSE_TO_ENEMY_TERRITORY',
      message: 'Models must be set up at least 9" from enemy territory.',
      models: tooCloseToEnemy,
    });
  }

  const others: Footprint[] = [];
  for (const id of state.unitOrder) {
    const other = state.units[id];
    if (!other || other.id === unit.id || other.status !== 'battlefield') continue;
    others.push(...unitFootprints(scenario, other));
  }

  const overlapping = new Set<number>();
  const list = placement.models.map((m) => ({ i: m.i, fp: ends.get(m.i)! }));
  for (let a = 0; a < list.length; a++) {
    const { i, fp } = list[a]!;
    for (let b = a + 1; b < list.length; b++) {
      if (footprintsOverlap(fp, list[b]!.fp)) {
        overlapping.add(i);
        overlapping.add(list[b]!.i);
      }
    }
    if (others.some((o) => footprintsOverlap(fp, o))) {
      overlapping.add(i);
    }
    // Units may be set up on features 1" high or less (ruins, outcrops), not on the spires;
    // faction terrain is never set up on a terrain feature.
    if (
      battlefield.terrain.some(
        (t) => (isTerrain || !allowsSetUpOn(t)) && footprintOverlapsPolygon(fp, t.polygon),
      )
    ) {
      overlapping.add(i);
    }
    if (isTerrain) {
      if (battlefield.objectives.some((o) => footprintToPoint(fp, o.x, o.y) <= 3)) {
        overlapping.add(i);
      }
    }
  }
  if (overlapping.size > 0) {
    violations.push({
      code: 'OVERLAP',
      message: 'Bases cannot overlap.',
      models: [...overlapping].sort((a, b) => a - b),
    });
  }

  const coherency = checkCoherencyFootprints(alive.map((i) => ends.get(i)!));
  if (!coherency.coherent) {
    violations.push({
      code: 'COHERENCY',
      message:
        coherency.required === 2
          ? 'Each model must be within ½" of two others in its unit.'
          : 'Each model must be within ½" of another model in its unit.',
      models: coherency.lacking.map((k) => alive[k]!),
    });
  }

  return violations;
}

/** Keeps a little air between units so they are easy to tell apart and to pick. */
function gapBelow(a: Footprint, b: Footprint, gap: number): boolean {
  if (a.kind === 'polygon' || b.kind === 'polygon') return footprintGap(a, b) < gap;
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const ra =
    a.kind === 'circle'
      ? a.r
      : a.kind === 'ellipse'
        ? Math.max(a.rx, a.ry)
        : Math.hypot(a.hw, a.hh);
  const rb =
    b.kind === 'circle'
      ? b.r
      : b.kind === 'ellipse'
        ? Math.max(b.rx, b.ry)
        : Math.hypot(b.hw, b.hh);
  return d - ra - rb < gap;
}

/**
 * Deterministic placement finder for the NPC (and `defaultAction` during `'deploy'` placement):
 * searches candidate positions `(x, y)` on a 0.5" grid inside `own` territory, ordered nearest
 * to the enemy/board centre first, forms the unit with `formPlacement`, and returns the first
 * placement where `checkDeployPlacement` has 0 violations (preferring at least 1" gap from
 * friendly deployed units when possible, falling back to any legal non-overlapping placement).
 */
export function npcDeployPlacement(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): Placement | null {
  const { battlefield } = scenario;
  const own = battlefield.territories[scenario.sides[unit.owner]];
  const enemy = battlefield.territories[scenario.sides[opponent(unit.owner)]];
  const home = polygonCentroid(own);
  const boardCentre = { x: battlefield.width / 2, y: battlefield.height / 2 };
  const facing = facingTowards(home, boardCentre);
  const profile = profileOf(scenario, unit);
  const isTerrain = profile.isFactionTerrain;
  const minGap = isTerrain ? 3 : battlefield.deployGapFromEnemyTerritory;

  const candidates: { x: number; y: number; key: number }[] = [];
  for (let x = 1; x <= battlefield.width - 1; x += 0.5) {
    for (let y = 1; y <= battlefield.height - 1; y += 0.5) {
      if (!own.some((poly) => pointInPolygon([x, y], poly))) continue;
      const ptFp: Footprint = { kind: 'circle', cx: x, cy: y, r: 0 };
      if (enemy.some((poly) => footprintDistanceToPolygon(ptFp, poly) + DIST_EPS < minGap)) {
        continue;
      }
      const toEnemy = Math.abs(x - boardCentre.x);
      candidates.push({ x, y, key: toEnemy * 100 + Math.abs(y - home.y) });
    }
  }
  candidates.sort((a, b) => a.key - b.key);

  const friendlyFps: Footprint[] = [];
  for (const u of unitsOf(state, unit.owner)) {
    if (u.id === unit.id) continue;
    friendlyFps.push(...unitFootprints(scenario, u));
  }

  // A spot whose centre lies on another unit's base can never hold the unit's centre model:
  // skip it before forming the unit (keeps a crowded territory cheap to search).
  const allFps: Footprint[] = [];
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    if (u.id !== unit.id && u.status === 'battlefield') allFps.push(...unitFootprints(scenario, u));
  }
  const open = candidates.filter((c) => !allFps.some((fp) => footprintToPoint(fp, c.x, c.y) <= 0));

  // Facing the enemy first, then the other three ways; a legal placement with a little air
  // around it is preferred, then any legal one. Never an illegal placement: null when none.
  for (const turn of [0, 90, 270, 180]) {
    let fallback: Placement | null = null;
    for (const c of open) {
      const placement = formPlacement(scenario, unit, { x: c.x, y: c.y }, facing + turn);
      const fps = placement.models.map((m) =>
        baseFootprint(profile.models[m.i]!.base, m.x, m.y, m.rot),
      );
      const hasAir = fps.every((fp) => !friendlyFps.some((other) => gapBelow(fp, other, 1)));
      if (!hasAir && fallback !== null) continue;
      if (checkDeployPlacement(scenario, state, unit, placement).length !== 0) continue;
      if (hasAir) return placement;
      fallback = placement;
    }
    if (fallback) return fallback;
  }
  return null;
}

/**
 * Fast set-up for faction terrain: creates each army's faction terrain and sets it up
 * legally behind the already deployed `units` (attacker first): the legal spot furthest from
 * the enemy, so it does not stand in the army's way. A piece with no legal place is left out.
 */
export function placeFactionTerrain(scenario: Scenario, units: readonly UnitState[]): UnitState[] {
  const { battlefield } = scenario;
  const boardCentre = { x: battlefield.width / 2, y: battlefield.height / 2 };
  const terrain = createReserveUnits(scenario).filter(
    (u) => profileOf(scenario, u).isFactionTerrain,
  );
  const all = [...units];
  const view = {
    get units() {
      return Object.fromEntries(all.map((u) => [u.id, u]));
    },
    get unitOrder() {
      return all.map((u) => u.id);
    },
  } as unknown as GameState;
  const placed: UnitState[] = [];
  for (const t of terrain) {
    const own = battlefield.territories[scenario.sides[t.owner]];
    const home = polygonCentroid(own);
    const facing = facingTowards(home, boardCentre);
    const candidates: { x: number; y: number; key: number }[] = [];
    for (let x = 1; x <= battlefield.width - 1; x += 0.5) {
      for (let y = 1; y <= battlefield.height - 1; y += 0.5) {
        if (!own.some((poly) => pointInPolygon([x, y], poly))) continue;
        candidates.push({ x, y, key: -Math.abs(x - boardCentre.x) * 100 + Math.abs(y - home.y) });
      }
    }
    candidates.sort((a, b) => a.key - b.key);
    for (const c of candidates) {
      const placement = formPlacement(scenario, t, { x: c.x, y: c.y }, facing);
      if (checkDeployPlacement(scenario, view, t, placement).length > 0) continue;
      for (const m of placement.models) {
        const model = t.models[m.i]!;
        model.x = m.x;
        model.y = m.y;
        model.rot = m.rot;
      }
      t.status = 'battlefield';
      all.push(t);
      placed.push(t);
      break;
    }
  }
  return placed;
}
