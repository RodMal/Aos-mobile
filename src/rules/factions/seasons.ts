/**
 * Seasons Of War (Alarielle the Everqueen, d584-62b7-8083-8f63) and Creeping Dread (Sylvaneth
 * battle trait, c9cf-21d7-880d-e59f), from data/factions/sylvaneth.json:
 *
 * - Seasons Of War, Start of Battle Round, "You must use this ability": pick one effect for the
 *   rest of the battle round, not the one picked in the previous round. The Burgeoning: Ever
 *   Growing may target any terrain feature the opponent does not control. The Reaping: +1 to
 *   casting and chanting rolls for friendly SYLVANETH units wholly within 12" of Alarielle. The
 *   Dwindling: friendly SYLVANETH units may charge after retreating, and retreating inflicts no
 *   mortal damage on them. Everdusk: Creeping Dread may pick up to 3 targets.
 * - Creeping Dread, Once Per Turn (Army), Start of Any Turn: pick an enemy unit within the
 *   creeping overgrowth. For the rest of the turn, the first command the opponent declares for
 *   it while it is not wholly within 12" of a HERO in their army costs 1 more command point
 *   (the engine charges the extra point; a command that cannot be paid for is not offered, which
 *   is the same as spending the points for nothing).
 */
import {
  inCreepingOvergrowth,
  featureController,
  hasOvergrownToken,
  terrainFeatures,
} from '../../engine/overgrowth.js';
import { hasKeyword, opponent, profileOf, unitsOf, unitWhollyWithin } from '../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitId, UnitState } from '../../engine/types.js';
import {
  ALARIELLE_SEASONS,
  CREEPING_DREAD_ID,
  SEASONS_OF_WAR_ID,
  type AlarielleSeason,
} from './sylvaneth.js';

/** The unit with Seasons Of War on the battlefield (Alarielle), if any. */
export function seasonsUnit(scenario: Scenario, state: GameState): UnitState | undefined {
  return state.unitOrder
    .map((id) => state.units[id]!)
    .find(
      (u) =>
        u.status === 'battlefield' &&
        profileOf(scenario, u).abilities.some((a) => a.id === SEASONS_OF_WAR_ID),
    );
}

/** The seasons that may be picked this round (not the previous round's). */
export function seasonsAllowed(state: GameState): AlarielleSeason[] {
  const last = state.alarielleSeason?.[state.round - 1];
  return ALARIELLE_SEASONS.filter((x) => x !== last);
}

/** The season in effect this round for `player`'s army, if they picked one. */
export function seasonFor(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): AlarielleSeason | null {
  const season = state.alarielleSeason?.[state.round];
  if (!season) return null;
  const owner = state.alarielleSeasonPlayer ?? seasonsUnit(scenario, state)?.owner;
  return owner === player ? (season as AlarielleSeason) : null;
}

/** The Reaping: +1 to casting and chanting rolls for this unit, or 0. */
export function reapingBonus(scenario: Scenario, state: GameState, unit: UnitState): number {
  if (seasonFor(scenario, state, unit.owner) !== 'reaping') return 0;
  if (!hasKeyword(scenario, unit, 'SYLVANETH')) return 0;
  const alarielle = seasonsUnit(scenario, state);
  if (!alarielle || alarielle.owner !== unit.owner) return 0;
  return unit.id === alarielle.id || unitWhollyWithin(scenario, alarielle, unit, 12) ? 1 : 0;
}

/** The Dwindling: this unit may charge after retreating and takes no retreat mortal damage. */
export function dwindling(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return (
    seasonFor(scenario, state, unit.owner) === 'dwindling' &&
    hasKeyword(scenario, unit, 'SYLVANETH')
  );
}

/**
 * The Burgeoning's pick for Ever Growing (an automatic choice, recorded as a simplification):
 * the terrain feature without a friendly token that the opponent does not control, closest to
 * the centre of the battlefield, so the overgrowth reaches the middle of the table.
 */
export function burgeoningPick(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): string | undefined {
  if (seasonFor(scenario, state, player) !== 'burgeoning') return undefined;
  const cx = scenario.battlefield.width / 2;
  const cy = scenario.battlefield.height / 2;
  let best: { id: string; d: number } | undefined;
  for (const f of terrainFeatures(scenario, state)) {
    if (hasOvergrownToken(scenario, state, player, f.id)) continue;
    if (featureController(scenario, state, f) === opponent(player)) continue;
    const pts =
      f.polygon ??
      (f.unit ? f.unit.models.filter((m) => m.alive).map((m) => [m.x, m.y] as const) : []);
    if (pts.length === 0) continue;
    const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const d = Math.hypot(x - cx, y - cy);
    if (!best || d < best.d) best = { id: f.id, d };
  }
  return best?.id;
}

/** A varying NPC pick: the season that helps most now, never last round's. */
export function npcSeason(scenario: Scenario, state: GameState, player: PlayerId): AlarielleSeason {
  const allowed = seasonsAllowed(state);
  const alarielle = seasonsUnit(scenario, state);
  const mine = unitsOf(state, player).filter((u) => hasKeyword(scenario, u, 'SYLVANETH'));
  const casters = mine.filter((u) => {
    const p = profileOf(scenario, u);
    return (
      ((p.wizard ?? 0) > 0 || (p.priest ?? 0) > 0) &&
      alarielle &&
      (u.id === alarielle.id || unitWhollyWithin(scenario, alarielle, u, 12))
    );
  }).length;
  const dreadTargets = creepingDreadCandidates(scenario, state, player).length;
  const order: AlarielleSeason[] = [];
  if (dreadTargets >= 2) order.push('everdusk');
  if (casters >= 2) order.push('reaping');
  order.push('burgeoning', 'reaping', 'dwindling', 'everdusk');
  return order.find((x) => allowed.includes(x)) ?? allowed[0]!;
}

// ─── Creeping Dread ─────────────────────────────────────────────────────────────

export function hasCreepingDread(scenario: Scenario, player: PlayerId): boolean {
  return scenario.armies[player].battleTraits.some((a) => a.id === CREEPING_DREAD_ID);
}

/** Enemy units within `player`'s creeping overgrowth (faction terrain and manifestations aside). */
export function creepingDreadCandidates(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitId[] {
  return unitsOf(state, opponent(player))
    .filter((u) => {
      const p = profileOf(scenario, u);
      return !p.isFactionTerrain && !p.isManifestation;
    })
    .filter((u) => inCreepingOvergrowth(scenario, state, u, player, false))
    .map((u) => u.id);
}

/** How many targets Creeping Dread may pick (3 under Everdusk). */
export function creepingDreadMax(scenario: Scenario, state: GameState, player: PlayerId): number {
  return seasonFor(scenario, state, player) === 'everdusk' ? 3 : 1;
}

/** The extra command point a command for `unit` costs now because of Creeping Dread. */
export function creepingDreadSurcharge(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): number {
  const dread = state.creepingDread;
  if (!dread || !dread.targets.includes(unit.id) || dread.spent.includes(unit.id)) return 0;
  const heroNear = unitsOf(state, unit.owner).some(
    (h) =>
      h.id !== unit.id &&
      hasKeyword(scenario, h, 'HERO') &&
      !profileOf(scenario, h).isManifestation &&
      unitWhollyWithin(scenario, h, unit, 12),
  );
  return heroNear ? 0 : 1;
}

/** The NPC's Creeping Dread targets: the enemy units worth most points, up to `max`. */
export function npcCreepingDreadTargets(
  scenario: Scenario,
  state: GameState,
  candidates: readonly UnitId[],
  max: number,
): UnitId[] {
  return [...candidates]
    .sort(
      (a, b) =>
        profileOf(scenario, state.units[b]!).points - profileOf(scenario, state.units[a]!).points,
    )
    .slice(0, max);
}
