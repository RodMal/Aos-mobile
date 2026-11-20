/**
 * The NPC's use of the Seraphon activated abilities (R12, I108): Scry the Stars, Star-venom and
 * Celestial Conduit are used only when they help its plan to win, judged by cheap distance and
 * objective checks (no dice, no simulation, so the 1200 ms per-game budget is untouched).
 */
import { controlScores } from '../engine/index.js';
import {
  hasKeyword,
  profileOf,
  unitCentre,
  unitDistance,
  unitWhollyWithin,
  unitsOf,
  isFactionTerrainUnit,
} from '../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitId, UnitState } from '../engine/types.js';

/** An enemy this close (edge to edge) can reach the unit next turn: a move, or a charge. */
const THREAT_RANGE = 14;
/** Star-venom is worth it against a unit that can fight a friendly unit this close. */
const VENOM_RANGE = 12;
/** An objective this close to a unit may be contested by the end of the turn. */
const OBJECTIVE_REACH = 12;

const enemiesOf = (scenario: Scenario, state: GameState, player: PlayerId): UnitState[] =>
  unitsOf(state, player === 0 ? 1 : 0).filter(
    (e) => e.status === 'battlefield' && !isFactionTerrainUnit(scenario, e),
  );

/** A friendly unit with an enemy within reach of it next turn. */
function exposed(scenario: Scenario, unit: UnitState, enemies: readonly UnitState[]): boolean {
  return enemies.some((e) => unitDistance(scenario, unit, e) <= THREAT_RANGE);
}

/** Scry the Stars: from round 2 (the dice are the round number), when a unit it can ward is exposed. */
export function npcScryWorthUsing(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  candidates: readonly UnitId[],
): boolean {
  if (state.round < 2) return false;
  const enemies = enemiesOf(scenario, state, player);
  return candidates.some((id) => exposed(scenario, state.units[id]!, enemies));
}

/** The units to ward, exposed ones first, the most valuable first (ties: unit id). */
export function npcScryPicks(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  units: readonly UnitId[],
  max: number,
): UnitId[] {
  const enemies = enemiesOf(scenario, state, player);
  const rank = (id: UnitId): number => {
    const u = state.units[id]!;
    return (exposed(scenario, u, enemies) ? 10000 : 0) + profileOf(scenario, u).points;
  };
  return [...units].sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : 1)).slice(0, max);
}

/**
 * Star-venom: the target worth the most points that has a melee attack and can fight a friendly
 * unit (one within 12"); null when none does, and then the NPC keeps the ability.
 */
export function npcStarVenomTarget(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  targets: readonly UnitId[],
): UnitId | null {
  const mine = unitsOf(state, unit.owner).filter(
    (u) => u.status === 'battlefield' && !isFactionTerrainUnit(scenario, u),
  );
  let best: UnitId | null = null;
  let bestPoints = -Infinity;
  for (const id of targets) {
    const t = state.units[id]!;
    const profile = profileOf(scenario, t);
    if (!profile.weapons.some((w) => w.kind === 'melee')) continue;
    if (!mine.some((u) => unitDistance(scenario, t, u) <= VENOM_RANGE)) continue;
    if (profile.points > bestPoints) {
      best = id;
      bestPoints = profile.points;
    }
  }
  return best;
}

/**
 * Celestial Conduit adds 3 to the control scores of friendly Seraphon units wholly within 12" of
 * the Bearer: worth a reaction when one of them (the Bearer included) is within reach of an
 * objective its army does not hold.
 */
export function npcConduitHelps(scenario: Scenario, state: GameState, bearer: UnitState): boolean {
  const scores = controlScores(scenario, state);
  const wanted = scenario.battlefield.objectives.filter((o) => {
    const controller = state.objectives.find((x) => x.id === o.id)?.controller ?? null;
    const [a, b] = scores.get(o.id) ?? [0, 0];
    return controller !== bearer.owner || (bearer.owner === 0 ? a : b) === 0;
  });
  if (wanted.length === 0) return false;
  return unitsOf(state, bearer.owner).some((u) => {
    if (u.status !== 'battlefield' || !hasKeyword(scenario, u, 'SERAPHON')) return false;
    if (isFactionTerrainUnit(scenario, u)) return false;
    if (u.id !== bearer.id && !unitWhollyWithin(scenario, bearer, u, 12)) return false;
    const c = unitCentre(u);
    return wanted.some((o) => Math.hypot(o.x - c.x, o.y - c.y) <= OBJECTIVE_REACH + o.radius);
  });
}
