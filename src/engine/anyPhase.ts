/**
 * "Any ... Phase" abilities as reactions (tasks R13 and R14, owner rulings of 2026-11-20).
 *
 * - Core 13.1: abilities that are not FIGHT abilities are used before fighting starts. Groundshaker,
 *   Venomite Swarm and Ark of Sotek are offered in the start-of-combat window with Rhythm of the
 *   Chase (the active player first, then the defender), and never while a fighter is picked.
 * - Core 13.0: an "Any Hero Phase" or "Any Charge Phase" ability can also be used in the opponent's
 *   turn, after the active player has finished the phase (Lifebloom, Living Battering Ram).
 *
 * Each is answered with one `ability` action; readings in docs/RULES-DECISIONS.md I104 and I106.
 */
import { ARK_OF_SOTEK_ID, ARMOUR_CRUNCHER_ID, VENOMITE_SWARM_ID } from './abilities/seraphon.js';
import {
  GROUNDSHAKER_ID,
  LIFEBLOOM_ID,
  LIVING_BATTERING_RAM_ID,
  RHYTHM_OF_THE_CHASE_ID,
} from './abilities/sylvaneth.js';
import { illegal, type Ctx } from './ctx.js';
import {
  VENGEFUL_FOREST_SPIRITS_ID,
  vengefulForestSpirits,
  vengefulTargets,
} from './factionTerrainActive.js';
import { rhythmTargets } from './relocate.js';
import {
  ARK_MAX_TARGETS,
  ARMOUR_CRUNCHER_ROLL_ID,
  arkOfSotek,
  armourCruncher,
  cruncherAvailable,
  arkTargets,
  venomiteSwarm,
  venomiteTargets,
} from './seraphonActive.js';
import {
  batteringRamTargets,
  groundshakerTargets,
  lifebloomUsable,
  useBatteringRam,
  useGroundshaker,
  useLifebloom,
} from './sylvanethActive.js';
import { unitsOf } from './query.js';
import type {
  Action,
  GameState,
  PlayerId,
  ReactionOption,
  Scenario,
  UnitId,
  UnitState,
} from './types.js';

type Kind = NonNullable<ReactionOption['ability']>;

/** The reaction kinds this file answers, by the ability id used in the `ability` action. */
const KIND_OF: Readonly<Record<string, Kind>> = {
  [LIFEBLOOM_ID]: 'lifebloom',
  [LIVING_BATTERING_RAM_ID]: 'livingBatteringRam',
  [GROUNDSHAKER_ID]: 'groundshaker',
  [VENOMITE_SWARM_ID]: 'venomiteSwarm',
  [ARK_OF_SOTEK_ID]: 'arkOfSotek',
  [ARMOUR_CRUNCHER_ID]: 'armourCruncher',
  [ARMOUR_CRUNCHER_ROLL_ID]: 'armourCruncherRoll',
  [VENGEFUL_FOREST_SPIRITS_ID]: 'vengefulForestSpirits',
};

/** The reaction kind of an `ability` action's id (Rhythm of the Chase included), if it has one. */
export const kindOfAbilityId = (id: string): Kind | undefined =>
  KIND_OF[id] ?? (id === RHYTHM_OF_THE_CHASE_ID ? 'rhythmOfTheChase' : undefined);

/** The option for `kind` as it stands now (targets recomputed), or null when it no longer applies. */
function current(
  scenario: Scenario,
  state: GameState,
  kind: Kind,
  unit: UnitState,
): ReactionOption | null {
  const base = { ability: kind, unit: unit.id, cost: 0 };
  switch (kind) {
    case 'lifebloom':
      return lifebloomUsable(scenario, state, unit) ? base : null;
    case 'livingBatteringRam': {
      const targets = batteringRamTargets(scenario, state, unit);
      return targets.length > 0 ? { ...base, targets } : null;
    }
    case 'groundshaker': {
      const targets = groundshakerTargets(scenario, state, unit);
      return targets.length > 0 ? { ...base, targets } : null;
    }
    case 'venomiteSwarm': {
      const targets = venomiteTargets(scenario, state, unit);
      return targets.length > 0 ? { ...base, targets } : null;
    }
    case 'arkOfSotek': {
      const targets = arkTargets(scenario, state, unit);
      return targets.length > 0
        ? { ...base, targets, maxTargets: Math.min(ARK_MAX_TARGETS, targets.length) }
        : null;
    }
    case 'armourCruncher':
    case 'armourCruncherRoll': {
      if (kind === 'armourCruncher' && (state.players[unit.owner].rageDice ?? 0) < 1) return null;
      const targets = cruncherAvailable(scenario, state, unit);
      return targets.length > 0 ? { ...base, targets } : null;
    }
    case 'vengefulForestSpirits': {
      const targets = vengefulTargets(scenario, state, unit);
      return targets.length > 0 ? { ...base, targets } : null;
    }
    case 'rhythmOfTheChase': {
      const targets = rhythmTargets(scenario, state, unit);
      return targets.length > 0 ? { ...base, targets } : null;
    }
    default:
      return null;
  }
}

/** True for the start-of-combat ability kinds. */
export const isStartOfCombatKind = (kind: Kind | undefined): boolean =>
  kind === 'rhythmOfTheChase' ||
  kind === 'groundshaker' ||
  kind === 'venomiteSwarm' ||
  kind === 'arkOfSotek' ||
  kind === 'armourCruncher' ||
  kind === 'armourCruncherRoll' ||
  kind === 'vengefulForestSpirits';

/**
 * The start-of-combat window of `player` (Core 13.1): Rhythm of the Chase, Groundshaker, Venomite
 * Swarm and Ark of Sotek, one option per unit and ability.
 */
export function startOfCombatAbilities(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): ReactionOption[] {
  const kinds: Kind[] = [
    'rhythmOfTheChase',
    'groundshaker',
    'venomiteSwarm',
    'arkOfSotek',
    'armourCruncher',
    'armourCruncherRoll',
    'vengefulForestSpirits',
  ];
  return unitsOf(state, player).flatMap((u) =>
    kinds.flatMap((k) => {
      const o = current(scenario, state, k, u);
      return o ? [o] : [];
    }),
  );
}

/**
 * "Any Hero Phase" and "Any Charge Phase" abilities of the player who is not active, offered after
 * the active player has finished the phase (Core 13.0).
 */
export function endOfPhaseAbilities(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): ReactionOption[] {
  const kind: Kind | null =
    state.phase === 'hero' ? 'lifebloom' : state.phase === 'charge' ? 'livingBatteringRam' : null;
  if (!kind) return [];
  return unitsOf(state, player).flatMap((u) => {
    const o = current(scenario, state, kind, u);
    return o ? [o] : [];
  });
}

/** An offered option, checked again against the state (an earlier ability may have changed it). */
export function refreshOption(
  scenario: Scenario,
  state: GameState,
  option: ReactionOption,
): ReactionOption | null {
  const unit = state.units[option.unit];
  if (!unit || !option.ability || !isStartOfCombatKind(option.ability)) return option;
  return current(scenario, state, option.ability, unit);
}

/**
 * Uses one of these abilities from a reaction frame. Returns false when `action` is not one of
 * them (the caller goes on); throws when it is one that is not on offer now.
 */
export function useReactionAbility(
  ctx: Ctx,
  options: readonly ReactionOption[],
  action: Action,
): boolean {
  if (action.t !== 'ability') return false;
  const kind = KIND_OF[action.abilityId];
  if (!kind) return false;
  const { s, scenario } = ctx;
  const unit = s.units[action.unit];
  const offered = options.some((o) => o.ability === kind && o.unit === action.unit);
  const opt = unit && offered ? current(scenario, s, kind, unit) : null;
  if (!unit || !opt) return illegal('That ability is not available now.');
  const targets = opt.targets ?? [];
  const pick = (ids: UnitId[], max: number): UnitState[] => {
    if (ids.length < 1 || ids.length > max) illegal(`Pick 1 to ${max} targets.`);
    if (new Set(ids).size !== ids.length) illegal('Each target can be picked only once.');
    const bad = ids.find((id) => !targets.includes(id));
    if (bad) illegal(`${bad} is not a legal target.`);
    return ids.map((id) => s.units[id]!);
  };
  const one = (): UnitState =>
    pick(action.target ? [action.target] : (action.targets ?? targets.slice(0, 1)), 1)[0]!;
  switch (kind) {
    case 'lifebloom':
      useLifebloom(ctx, unit);
      break;
    case 'livingBatteringRam':
      useBatteringRam(ctx, unit, one());
      break;
    case 'groundshaker':
      useGroundshaker(ctx, unit, one());
      break;
    case 'venomiteSwarm':
      venomiteSwarm(ctx, unit, one());
      break;
    case 'vengefulForestSpirits':
      vengefulForestSpirits(
        ctx,
        unit,
        targets.map((id) => s.units[id]!),
      );
      break;
    case 'armourCruncher':
    case 'armourCruncherRoll':
      armourCruncher(ctx, unit, one(), kind === 'armourCruncher');
      break;
    default:
      arkOfSotek(
        ctx,
        unit,
        pick(
          action.targets ?? (action.target ? [action.target] : targets.slice(0, 1)),
          opt.maxTargets ?? 1,
        ),
      );
  }
  return true;
}
