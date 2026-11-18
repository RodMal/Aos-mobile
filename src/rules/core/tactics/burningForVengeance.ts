import { type Polygon } from '../../../geom/index.js';
import {
  COMBAT_RANGE,
  DIST_EPS,
  inCombat,
  unitFootprints,
  unitsWithin,
} from '../../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitId } from '../../../engine/types.js';
import { footprintToPoint } from '../objectives.js';
import {
  type ActiveTacticTier,
  eligibleArmyUnits,
  objectiveWhollyOutsideFriendlyTerritory,
  unitContestsObjective,
  unitWhollyWithinPolygons,
} from './shared.js';

export function evaluateBurningForVengeance(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  tier: ActiveTacticTier,
): boolean {
  const friendlyUnits = eligibleArmyUnits(scenario, state, player);
  const cx = scenario.battlefield.width / 2;
  const cy = scenario.battlefield.height / 2;

  if (tier === 'affray') {
    // Search Every Inch: a different friendly unit wholly within each large quarter of the
    // battlefield, each more than 9" from the centre, and at most 1 set up this turn.
    const w = scenario.battlefield.width;
    const h = scenario.battlefield.height;
    const quarters: Polygon[] = [
      [
        [0, 0],
        [cx, 0],
        [cx, cy],
        [0, cy],
      ],
      [
        [cx, 0],
        [w, 0],
        [w, cy],
        [cx, cy],
      ],
      [
        [0, cy],
        [cx, cy],
        [cx, h],
        [0, h],
      ],
      [
        [cx, cy],
        [w, cy],
        [w, h],
        [cx, h],
      ],
    ];
    const farFromCentre = friendlyUnits.filter((u) => {
      const fps = unitFootprints(scenario, u);
      return fps.length > 0 && fps.every((fp) => footprintToPoint(fp, cx, cy) > 9 + DIST_EPS);
    });
    const perQuarter = quarters.map((q) =>
      farFromCentre.filter((u) => unitWhollyWithinPolygons(scenario, u, [q])),
    );
    const assign = (qi: number, used: Set<UnitId>, setUpCount: number): boolean => {
      if (qi >= 4) return true;
      for (const u of perQuarter[qi]!) {
        if (used.has(u.id)) continue;
        const nextSetUp = setUpCount + (u.setUpThisTurn ? 1 : 0);
        if (nextSetUp > 1) continue;
        used.add(u.id);
        if (assign(qi + 1, used, nextSetUp)) return true;
        used.delete(u.id);
      }
      return false;
    };
    return assign(0, new Set(), 0);
  }

  const fugitiveId = state.players[player].fugitiveUnit;
  const fugitive = fugitiveId ? state.units[fugitiveId] : undefined;
  const fugitiveOnBoard = fugitive && fugitive.status === 'battlefield' ? fugitive : null;

  if (tier === 'strike') {
    // Quick Pursuit: 3+ friendly units not in combat within 12" of the enemy fugitive,
    // OR no enemy fugitive on the battlefield.
    if (!fugitiveOnBoard) return true;
    return (
      friendlyUnits.filter(
        (u) => !inCombat(scenario, state, u) && unitsWithin(scenario, u, fugitiveOnBoard, 12),
      ).length >= 3
    );
  }

  // Domination — Bring Them In: 3+ friendly units in combat with the enemy fugitive,
  // OR no enemy fugitive on the battlefield and 3+ friendly units contesting the same
  // objective wholly outside friendly territory.
  if (fugitiveOnBoard) {
    return (
      friendlyUnits.filter((u) => unitsWithin(scenario, u, fugitiveOnBoard, COMBAT_RANGE)).length >=
      3
    );
  }
  return scenario.battlefield.objectives.some(
    (obj) =>
      objectiveWhollyOutsideFriendlyTerritory(scenario, player, obj) &&
      friendlyUnits.filter((u) => unitContestsObjective(scenario, u, obj)).length >= 3,
  );
}
