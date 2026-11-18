/**
 * Seraphon Asterisms (data/factions/seraphon.json):
 *
 * - The Great Plan (9db2-50c6-6181-fc51), Once Per Battle, Deployment Phase, "You must use this
 *   ability": pick an Asterism to be prophesied. Only prophesied Asterisms apply.
 * - Further the Great Plan (4d17-ddf6-7d2a-9889), Start of Battle Round, not in round 1: pick an
 *   Asterism not picked before this battle; it is prophesied only if its condition is met.
 * - Itzl the Tamer (360d-...): Companion weapons of friendly SERAPHON have Crit (2 Hits).
 * - Quetzl the Preserver (5089-...): -1 Rend on melee weapons against friendly SERAPHON units
 *   wholly within friendly territory.
 * - Sotek the Deliverer (6960-...): +2 Move for friendly SERAPHON units.
 * - Tepok the Seer (90ae-...): +1 to casting rolls for friendly SERAPHON units.
 *
 * Readings are in docs/RULES-DECISIONS.md (I76 to I81).
 */
import type { Weapon } from '../../data/profile.js';
import { hasKeyword, inCombat, opponent, profileOf } from '../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitState } from '../../engine/types.js';
import type { Modifier } from '../core/modifiers.js';
import { friendlyTerritories, unitWhollyWithinPolygons } from '../core/tactics/shared.js';

export const GREAT_PLAN_ID = '9db2-50c6-6181-fc51';
export const FURTHER_GREAT_PLAN_ID = '4d17-ddf6-7d2a-9889';
export const ITZL_ID = '360d-fd80-f153-269f';
export const QUETZL_ID = '5089-fe1e-4dd7-5eb4';
export const SOTEK_ID = '6960-effd-2a46-d7d4';
export const TEPOK_ID = '90ae-3432-b3f3-4727';

export interface AsterismInfo {
  id: string;
  name: string;
  /** What it does, for the prompt. */
  text: string;
  /** What Further the Great Plan needs, for the prompt. */
  condition: string;
}

/** In the NPC's order of preference. */
export const ASTERISMS: readonly AsterismInfo[] = [
  {
    id: SOTEK_ID,
    name: 'Sotek the Deliverer',
    text: '+2 Move for your Seraphon',
    condition: 'The enemy general is in combat or has been destroyed',
  },
  {
    id: ITZL_ID,
    name: 'Itzl the Tamer',
    text: 'Your Seraphon Companion weapons have Crit (2 Hits)',
    condition: '3 or more enemy units have been destroyed',
  },
  {
    id: QUETZL_ID,
    name: 'Quetzl the Preserver',
    text: '-1 Rend on melee attacks against your Seraphon wholly in your territory',
    condition: 'No enemy units are wholly within your territory',
  },
  {
    id: TEPOK_ID,
    name: 'Tepok the Seer',
    text: '+1 to casting rolls for your Seraphon',
    condition: 'You have a Slann on the battlefield and none is in combat or destroyed',
  },
];

export function hasGreatPlan(scenario: Scenario, player: PlayerId): boolean {
  return scenario.armies[player].battleTraits.some((a) => a.id === GREAT_PLAN_ID);
}

/** The Asterisms in force for `player`. */
export function prophesied(state: GameState, player: PlayerId): string[] {
  return state.asterisms?.[player]?.prophesied ?? [];
}

export function isProphesied(state: GameState, player: PlayerId, id: string): boolean {
  return prophesied(state, player).includes(id);
}

/** The Asterisms `player` may still pick (not picked before this battle). */
export function asterismsAvailable(state: GameState, player: PlayerId): AsterismInfo[] {
  const picked = state.asterisms?.[player]?.picked ?? [];
  return ASTERISMS.filter((a) => !picked.includes(a.id));
}

/** True when the army's general is `unit`. */
function isGeneral(scenario: Scenario, unit: UnitState): boolean {
  return scenario.armies[unit.owner].list.units[unit.armyIndex]?.general === true;
}

/** The condition of Further the Great Plan for `id`, as `player` stands now. */
export function asterismConditionMet(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  id: string,
): boolean {
  const foes = Object.values(state.units).filter((u) => u.owner === opponent(player));
  switch (id) {
    case ITZL_ID:
      return foes.filter((u) => u.status === 'destroyed').length >= 3;
    case QUETZL_ID: {
      const territory = friendlyTerritories(scenario, player);
      return !foes.some(
        (u) =>
          u.status === 'battlefield' &&
          !profileOf(scenario, u).isFactionTerrain &&
          unitWhollyWithinPolygons(scenario, u, territory),
      );
    }
    case SOTEK_ID: {
      const general = foes.find((u) => !u.isManifestation && isGeneral(scenario, u));
      return (
        !!general &&
        (general.status === 'destroyed' ||
          (general.status === 'battlefield' && inCombat(scenario, state, general)))
      );
    }
    case TEPOK_ID: {
      const slann = Object.values(state.units).filter(
        (u) => u.owner === player && hasKeyword(scenario, u, 'SLANN'),
      );
      return (
        slann.some((u) => u.status === 'battlefield') &&
        slann.every(
          (u) =>
            u.status !== 'destroyed' &&
            !(u.status === 'battlefield' && inCombat(scenario, state, u)),
        )
      );
    }
    default:
      return false;
  }
}

/** The options of the decision: the unpicked Asterisms and whether each one's condition is met. */
export function asterismOptions(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  stage: 'great' | 'further',
): (AsterismInfo & { met: boolean })[] {
  return asterismsAvailable(state, player).map((a) => ({
    ...a,
    met: stage === 'great' || asterismConditionMet(scenario, state, player, a.id),
  }));
}

/**
 * The next Asterism question: for each Seraphon player, The Great Plan in round 1 (not yet
 * answered) or Further the Great Plan in a later round (not yet answered this round and an
 * Asterism left to pick).
 */
export function nextAsterismFrame(
  scenario: Scenario,
  state: GameState,
): { player: PlayerId; stage: 'great' | 'further' } | null {
  for (const player of [0, 1] as PlayerId[]) {
    if (!hasGreatPlan(scenario, player)) continue;
    const mine = state.asterisms?.[player];
    if (state.round === 1) {
      if (!mine) return { player, stage: 'great' };
    } else if (
      mine &&
      mine.askedRound !== state.round &&
      asterismsAvailable(state, player).length
    ) {
      return { player, stage: 'further' };
    }
  }
  return null;
}

/** Records the answer. `id` null is a pass (Further the Great Plan, or an old saved game). */
export function recordAsterism(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  stage: 'great' | 'further',
  id: string | null,
): string {
  const mine = state.asterisms?.[player] ?? { picked: [], prophesied: [], askedRound: 0 };
  state.asterisms = { ...state.asterisms, [player]: mine };
  mine.askedRound = state.round;
  if (id === null) return `Player ${player + 1} does not prophesy an Asterism.`;
  const info = ASTERISMS.find((a) => a.id === id)!;
  const met = stage === 'great' || asterismConditionMet(scenario, state, player, id);
  mine.picked.push(id);
  if (met) {
    mine.prophesied.push(id);
    return `Player ${player + 1} prophesies ${info.name}.`;
  }
  return `Player ${player + 1} picks ${info.name}, but its condition is not met: no effect.`;
}

/** The NPC's pick: the first Asterism in its order that may be prophesied, or null to pass. */
export function npcAsterism(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
  stage: 'great' | 'further',
): string | null {
  return asterismOptions(scenario, state, player, stage).find((o) => o.met)?.id ?? null;
}

// ─── Effects ────────────────────────────────────────────────────────────────────

function isSeraphon(scenario: Scenario, unit: UnitState): boolean {
  return hasKeyword(scenario, unit, 'SERAPHON');
}

/** Sotek the Deliverer: +2 to the Move characteristic (not to a Move of 0). */
export function moveOf(scenario: Scenario, state: GameState, unit: UnitState): number {
  const move = profileOf(scenario, unit).move;
  if (move > 0 && isProphesied(state, unit.owner, SOTEK_ID) && isSeraphon(scenario, unit)) {
    return move + 2;
  }
  return move;
}

/** Tepok the Seer: +1 to casting rolls. */
export function tepokBonus(scenario: Scenario, state: GameState, unit: UnitState): number {
  return isProphesied(state, unit.owner, TEPOK_ID) && isSeraphon(scenario, unit) ? 1 : 0;
}

/** Itzl the Tamer: the weapon as `unit` uses it (Companion weapons gain Crit (2 Hits)). */
export function asterismWeapon(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  weapon: Weapon,
): Weapon {
  if (
    !isProphesied(state, unit.owner, ITZL_ID) ||
    !isSeraphon(scenario, unit) ||
    !weapon.abilities.some((a) => a.t === 'companion') ||
    weapon.abilities.some((a) => a.t === 'crit2Hits')
  ) {
    return weapon;
  }
  return { ...weapon, abilities: [...weapon.abilities, { t: 'crit2Hits' }] };
}

/** Quetzl the Preserver: -1 Rend on melee attacks against the target. */
export function quetzlModifiers(
  scenario: Scenario,
  state: GameState,
  weapon: Weapon,
  target: UnitState,
): Modifier[] {
  if (
    weapon.kind !== 'melee' ||
    !isProphesied(state, target.owner, QUETZL_ID) ||
    !isSeraphon(scenario, target) ||
    !unitWhollyWithinPolygons(scenario, target, friendlyTerritories(scenario, target.owner))
  ) {
    return [];
  }
  return [{ stat: 'rend', value: -1, source: 'Quetzl the Preserver' }];
}
