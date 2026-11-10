/**
 * Automatic set-up: puts both armies on the battlefield in legal positions (wholly within
 * their own territory, 9" or more from enemy territory, in coherency, no overlaps).
 * This stands in for the alternating deployment phase until that is built.
 */
import {
  baseFootprint,
  footprintDistanceToPolygon,
  footprintInsidePolygon,
  footprintOverlapsPolygon,
  footprintsOverlap,
  layoutFormation,
  type Footprint,
  type Polygon,
} from '../geom/index.js';
import { defaultFrontage, facingTowards } from './query.js';
import type { ModelState, PlayerId, Scenario, UnitState } from './types.js';

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
    const candidates: { x: number; y: number; key: number }[] = [];
    for (let x = 1; x <= battlefield.width - 1; x += 0.5) {
      for (let y = 1; y <= battlefield.height - 1; y += 0.5) {
        const toEnemy = Math.abs(x - boardCentre.x);
        candidates.push({ x, y, key: toEnemy * 100 + Math.abs(y - home.y) });
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
      for (const c of candidates) {
        const tokens = layoutFormation(bases, frontage, [c.x, c.y], facing);
        const fps = tokens.map((t) => baseFootprint(t.base, t.x, t.y, t.rotation));
        const legal = fps.every(
          (fp) =>
            own.some((poly) => footprintInsidePolygon(fp, poly)) &&
            enemy.every(
              (poly) =>
                footprintDistanceToPolygon(fp, poly) >= battlefield.deployGapFromEnemyTerritory,
            ) &&
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
