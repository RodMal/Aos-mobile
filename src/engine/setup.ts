/**
 * Automatic set-up: puts both armies on the battlefield in legal positions (wholly within
 * their own territory, 9" or more from enemy territory, in coherency, no overlaps).
 * This stands in for the alternating deployment phase until that is built.
 */
import {
  baseFootprint,
  footprintGap,
  distancePointToBoundary,
  footprintDistanceToPolygon,
  footprintInsidePolygon,
  footprintOuterRadius,
  footprintOverlapsPolygon,
  footprintsOverlap,
  layoutFormation,
  pointInPolygon,
  type Footprint,
  type Polygon,
} from '../geom/index.js';
import { defaultFrontage, facingTowards } from './query.js';
import type { ModelState, PlayerId, Scenario, UnitState } from './types.js';

/** Slack for the shortcut tests in `deployArmies`, in inches. */
const MARGIN = 1e-6;

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
  return { x: x / n, y: y / n };
}

/** Creates every unit of both armies, deployed. Deterministic: no dice involved. */
export function deployArmies(scenario: Scenario): UnitState[] {
  const { battlefield } = scenario;
  const placed: Footprint[] = [];
  const units: UnitState[] = [];
  const boardCentre = { x: battlefield.width / 2, y: battlefield.height / 2 };

  for (const player of [0, 1] as PlayerId[]) {
    const own = battlefield.territories[scenario.sides[player]];
    const enemy = battlefield.territories[scenario.sides[player === 0 ? 1 : 0]];
    const home = polygonCentroid(own);
    const facing = facingTowards(home, boardCentre);
    // Candidate centres on a half-inch grid, nearest the enemy first, then nearest the
    // territory's centre line, so the army forms up along the front of its zone.
    // Every model must be wholly within the territory, so a formation centred outside the
    // territory's bounding box can never be legal: skip those centres.
    const ownPoints = own.flat();
    const minX = Math.min(...ownPoints.map((p) => p[0]));
    const maxX = Math.max(...ownPoints.map((p) => p[0]));
    const minY = Math.min(...ownPoints.map((p) => p[1]));
    const maxY = Math.max(...ownPoints.map((p) => p[1]));
    const candidates: {
      x: number;
      y: number;
      key: number;
      /** Distance from the point to enemy territory (0 inside it). */
      enemyDist: number;
      /** Distance from the point to the edge of own territory. */
      ownEdge: number;
      ownInside: boolean;
    }[] = [];
    for (let x = 1; x <= battlefield.width - 1; x += 0.5) {
      if (x < minX || x > maxX) continue;
      for (let y = 1; y <= battlefield.height - 1; y += 0.5) {
        if (y < minY || y > maxY) continue;
        const toEnemy = Math.abs(x - boardCentre.x);
        // Distances from the centre point, used below to settle most candidates cheaply.
        const p = [x, y] as const;
        let enemyDist = Infinity;
        for (const poly of enemy) {
          enemyDist = Math.min(
            enemyDist,
            pointInPolygon(p, poly) ? 0 : distancePointToBoundary(p, poly),
          );
        }
        let ownEdge = Infinity;
        for (const poly of own) ownEdge = Math.min(ownEdge, distancePointToBoundary(p, poly));
        candidates.push({
          x,
          y,
          key: toEnemy * 100 + Math.abs(y - home.y),
          enemyDist,
          ownEdge,
          ownInside: own.some((poly) => pointInPolygon(p, poly)),
        });
      }
    }
    candidates.sort((a, b) => a.key - b.key);

    // Biggest units first: they are the hardest to fit.
    const order = [...scenario.armies[player].units].sort(
      (a, b) => b.profile.models.length - a.profile.models.length || a.index - b.index,
    );
    for (const armyUnit of order) {
      const bases = armyUnit.profile.models.map((m) => m.base);
      const frontage = defaultFrontage(bases.length);
      let models: ModelState[] | null = null;
      // The formation's shape around its centre: `reach` is how far any base extends, and
      // `nearest` how close to the centre some base certainly comes. With the candidate's
      // precomputed distances these settle most centres without testing every model. The
      // margins keep borderline centres on the exact path, so the result is unchanged.
      const shape = layoutFormation(bases, frontage, [0, 0], facing).map((t) => {
        const fp = baseFootprint(t.base, 0, 0, t.rotation);
        const inner =
          fp.kind === 'polygon'
            ? 0
            : fp.kind === 'circle'
              ? fp.r
              : fp.kind === 'ellipse'
                ? Math.min(fp.rx, fp.ry)
                : Math.min(fp.hw, fp.hh);
        const d = Math.hypot(t.x, t.y);
        return { far: d + footprintOuterRadius(fp), near: d - inner };
      });
      const reach = Math.max(...shape.map((m) => m.far));
      const nearest = Math.min(...shape.map((m) => m.near));
      const gap = battlefield.deployGapFromEnemyTerritory;
      for (const c of candidates) {
        // Some base is certainly too close to enemy territory.
        if (c.enemyDist + nearest < gap - MARGIN) continue;
        // No base can be inside own territory.
        if (!c.ownInside && c.ownEdge > reach + MARGIN) continue;
        const clearOfEnemy = c.enemyDist - reach >= gap + MARGIN;
        const insideOwn = c.ownInside && c.ownEdge - reach >= MARGIN;
        const tokens = layoutFormation(bases, frontage, [c.x, c.y], facing);
        const fps = tokens.map((t) => baseFootprint(t.base, t.x, t.y, t.rotation));
        const legal = fps.every(
          (fp) =>
            (insideOwn || own.some((poly) => footprintInsidePolygon(fp, poly))) &&
            (clearOfEnemy || enemy.every((poly) => footprintDistanceToPolygon(fp, poly) >= gap)) &&
            !battlefield.terrain.some((t) => footprintOverlapsPolygon(fp, t.polygon)) &&
            !placed.some((other) => footprintsOverlap(fp, other) || gapBelow(fp, other, 1)),
        );
        if (!legal) continue;
        placed.push(...fps);
        models = [];
        for (const t of tokens) {
          models[t.modelIndex] = { x: t.x, y: t.y, rot: t.rotation, alive: true };
        }
        break;
      }
      if (!models) throw new Error(`no room to deploy ${armyUnit.profile.name}`);
      units.push({
        id: `${player}:${armyUnit.index}`,
        owner: player,
        profileId: armyUnit.profile.id,
        name: armyUnit.profile.name,
        armyIndex: armyUnit.index,
        models,
        damage: 0,
        status: 'battlefield',
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
