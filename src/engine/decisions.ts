import { getAbility, unitGrants } from './abilities/effects.js';
import { magicOptionsForUnit } from './abilities/magic.js';
import { mayShoot, weaponTargets } from './combat.js';
import { checkMovePlacement } from './movement.js';
import { inCombat, isFactionTerrainUnit, opponent, profileOf, unitById } from './query.js';
import { checkDeployPlacement } from './deployment.js';
import {
  canUseEruptionOfFury,
  eruptionOfFuryTargets,
  MAX_ERUPTION_RAGE_DICE,
} from '../rules/core/fury.js';
import { VENGEANCE_MAX, vengeanceCandidates, vengeanceFoes } from '../rules/factions/kroak.js';
import { asterismOptions } from '../rules/factions/seraphon.js';
import { combatOptions, scryOptions, starVenomOptions } from './seraphonActive.js';
import { batteringRamOptions, groundshakerOptions, lifebloomOptions } from './sylvanethActive.js';
import { burgeoningOptions, seasonsAllowed } from '../rules/factions/seasons.js';
import {
  chargeSetUpOptions,
  chargeRestriction,
  movementSetUpOptions,
  relocateViolations,
  rhythmTargets,
} from './relocate.js';
import { friendlyWyldwoods, isAwakenedWyldwood } from './overgrowth.js';
import { WYLDWOOD_SETUP_ID, canSetUpWyldwood, checkWyldwoodSetUp } from './wyldwood.js';
import {
  type AttackMode,
  type Decision,
  type GameState,
  type Placement,
  type PlayerId,
  type ReactionOption,
  type Scenario,
  type UnitId,
  type UnitOption,
  type UnitState,
  type Violation,
  type WeaponTargets,
} from './types.js';
import {
  bothRawFighters,
  canCharge,
  canFuryOfTheForest,
  canRally,
  commandBlocker,
  eligibleFighters,
  eligibleFrom,
  fightTierOf,
  moveOptions,
  optionalFighter,
  powerThroughTargets,
  goddessOfLifeUnits,
  landAwakensTargets,
  replacementHandle,
} from './eligibility.js';

/** The player who picks the next fighter, and the units they may pick from. */
export function fightPickerFor(
  scenario: Scenario,
  state: GameState,
): { player: PlayerId; units: UnitState[] } | null {
  const fighters = bothRawFighters(scenario, state);
  const tier = fightTierOf(scenario, state, fighters);
  if (!tier) return null;
  const first = state.fightTier === tier ? (state.fightPicker ?? state.active) : state.active;
  const mine = eligibleFrom(scenario, state, fighters, first, tier);
  if (mine.length > 0) return { player: first, units: mine };
  const other = opponent(first);
  const theirs = eligibleFrom(scenario, state, fighters, other, tier);
  return theirs.length > 0 ? { player: other, units: theirs } : null;
}

export function decision(scenario: Scenario, state: GameState): Decision | null {
  if (state.status === 'ended') return null;
  const top = state.stack[state.stack.length - 1];
  if (top) {
    switch (top.t) {
      case 'priority':
        return {
          kind: 'priority',
          player: top.winner,
          rolls: top.rolls,
          ...(top.reason ? { reason: top.reason } : {}),
        };
      case 'place':
        return {
          kind: 'place',
          player: unitById(state, top.unit).owner,
          unit: top.unit,
          reason: top.reason,
          allowance: top.allowance,
          dice: top.dice,
          canPass: top.reason !== 'deploy',
          ...(top.reason === 'pileIn' && !inCombat(scenario, state, unitById(state, top.unit))
            ? { free: true }
            : {}),
        };
      case 'targets':
        return {
          kind: 'targets',
          player: unitById(state, top.unit).owner,
          unit: top.unit,
          mode: top.mode,
        };
      case 'reaction':
        return {
          kind: 'reaction',
          player: top.player,
          options:
            top.trigger === 'start:combat'
              ? startOfCombatOptions(scenario, state, top.options)
              : top.options,
          trigger: top.trigger,
        };
      case 'magicalIntervention':
        return {
          kind: 'main',
          player: unitById(state, top.unit).owner,
          phase: 'hero',
        };
      case 'placeOfPower':
        return {
          kind: 'placeOfPower',
          player: top.player,
          hero: top.hero,
          terrain: top.terrain,
          boons: ['ignite_fury', 'channelled_wrath', 'dizzying_rage'],
        };
      case 'alarielleSeason':
        return {
          kind: 'alarielleSeason',
          player: top.player,
          unit: top.unit,
          seasons: seasonsAllowed(state),
          features: burgeoningOptions(scenario, state, top.player).map((f) => ({
            id: f.id,
            name: f.name,
          })),
          wyldwoods: friendlyWyldwoods(scenario, state, top.player).map((w) => ({
            id: w.id,
            name: w.name,
          })),
        };
      case 'creepingDread':
        return { kind: 'creepingDread', player: top.player, units: top.units, max: top.max };
      case 'asterism':
        return {
          kind: 'asterism',
          player: top.player,
          stage: top.stage,
          ...asterismOptions(scenario, state, top.player, top.stage),
        };
      case 'prayer':
        return {
          kind: 'prayer',
          player: unitById(state, top.unit).owner,
          unit: top.unit,
          ability: getAbility(top.abilityId)?.name ?? top.abilityId,
          die: top.die,
          points: top.points,
          banked: unitById(state, top.unit).ritualPoints ?? 0,
          targetValue: getAbility(top.abilityId)?.chantingValue ?? 4,
        };
      case 'fugitive':
        return { kind: 'fugitive', player: top.player, units: top.units };
      case 'vengeance': {
        if (top.stage === 'pick') {
          return {
            kind: 'vengeance',
            player: top.player,
            stage: 'pick',
            units: vengeanceCandidates(scenario, state, top.player).map((u) => u.id),
            max: VENGEANCE_MAX,
          };
        }
        const unit = unitById(state, top.queue[0]!);
        return {
          kind: 'vengeance',
          player: top.player,
          stage: 'enemy',
          units: vengeanceFoes(scenario, state, unit).map((u) => u.id),
          max: 1,
          unit: unit.id,
        };
      }
      case 'turnEnd':
        throw new Error('internal: unresolved turnEnd frame on top of the stack');
      case 'resolve':
      case 'allocate':
      case 'spell':
      case 'castReact':
      case 'chantReact':
      case 'endPhase':
        throw new Error(`internal: unresolved ${top.t} frame on top of the stack`);
    }
  }
  if (state.phase === 'combat') {
    const pick = fightPickerFor(scenario, state);
    if (pick !== null) {
      // Passing is allowed only when every unit the picker could fight with is merely
      // near enemy faction terrain.
      const canPass = pick.units.every((u) => optionalFighter(scenario, state, u));
      return { kind: 'fightPick', player: pick.player, canPass };
    }
  }
  return { kind: 'main', player: state.active, phase: state.phase };
}

export function unitOptions(scenario: Scenario, state: GameState, unitId: UnitId): UnitOption[] {
  const d = decision(scenario, state);
  const unit = state.units[unitId];
  if (!d || !unit || unit.status !== 'battlefield' || unit.owner !== d.player) return [];
  if (
    d.kind === 'main' &&
    wyldwoodHandle(scenario, state, unit) &&
    canSetUpWyldwood(scenario, state, unit.owner)
  ) {
    // Not the terrain acting: the player sets up a further piece (owner, 2026-11-11).
    const setUp: UnitOption = {
      t: 'ability',
      abilityId: WYLDWOOD_SETUP_ID,
      name: 'Set up an Awakened Wyldwood',
      kind: 'activated',
      targets: [],
    };
    if (isFactionTerrainUnit(scenario, unit)) return [setUp];
    return [...unitOptionsInner(scenario, state, unit, d), setUp];
  }
  if (isFactionTerrainUnit(scenario, unit)) return [];
  return unitOptionsInner(scenario, state, unit, d);
}

/**
 * The unit a player taps to set up a further Wyldwood: any of their Awakened Wyldwoods on the
 * battlefield (with none left, no further piece can be set up; see docs/RULES-DECISIONS.md).
 */
export function wyldwoodHandle(scenario: Scenario, _state: GameState, unit: UnitState): boolean {
  return isAwakenedWyldwood(scenario, unit);
}

export function unitOptionsInner(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  d: Decision,
): UnitOption[] {
  const unitId = unit.id;
  const top = state.stack[state.stack.length - 1];
  if (top?.t === 'magicalIntervention') {
    if (top.unit !== unitId) return [];
    return magicOptionsForUnit(scenario, state, unit);
  }
  if (d.kind === 'fightPick') {
    const fight: UnitOption[] = eligibleFighters(scenario, state, d.player).some(
      (u) => u.id === unitId,
    )
      ? [{ t: 'fight' }]
      : [];
    return [
      ...fight,
      ...combatOptions(scenario, state, unit),
      ...groundshakerOptions(scenario, state, unit),
    ];
  }
  if (d.kind !== 'main') return [];
  switch (d.phase) {
    case 'hero': {
      const opts: UnitOption[] = [...magicOptionsForUnit(scenario, state, unit)];
      if (canRally(scenario, state, unit)) {
        opts.push({ t: 'command', command: 'rally', cost: 1 });
      }
      opts.push(...scryOptions(scenario, state, unit), ...lifebloomOptions(scenario, state, unit));
      return opts;
    }
    case 'movement': {
      const moves = moveOptions(scenario, state, unit);
      const canRun = moves.some((o) => o.t === 'move' && o.kind === 'run');
      const opts: UnitOption[] = [...moves];
      if (canRun && !commandBlocker(scenario, state, unit.owner, 'atTheDouble', unit)) {
        opts.push({ t: 'command', command: 'atTheDouble', cost: 1 });
      }
      // The Goddess Of Life: offered on any Sylvaneth unit, as the unit using it may be destroyed.
      const goddess = replacementHandle(scenario, unit)
        ? goddessOfLifeUnits(scenario, state, unit.owner)
        : [];
      if (goddess.length > 0) {
        opts.push({ t: 'command', command: 'goddessOfLife', cost: 2, targets: goddess });
      }
      opts.push(...movementSetUpOptions(scenario, state, unit));
      return opts;
    }
    case 'shooting': {
      const grants = unitGrants(scenario, state, unit);
      const shoot: UnitOption[] =
        mayShoot(unit, grants.runAndShoot) &&
        weaponTargets(scenario, state, unit, 'shoot').length > 0
          ? [{ t: 'shoot' }]
          : [];
      return [...shoot, ...starVenomOptions(scenario, state, unit)];
    }
    case 'charge': {
      const opts: UnitOption[] = [];
      if (canCharge(scenario, state, unit)) opts.push({ t: 'charge' });
      if (
        unit.chargeDeclared &&
        !unit.charged &&
        !commandBlocker(scenario, state, unit.owner, 'forwardToVictory', unit)
      ) {
        opts.push({ t: 'command', command: 'forwardToVictory', cost: 1 });
      }
      opts.push(
        ...chargeSetUpOptions(scenario, state, unit),
        ...batteringRamOptions(scenario, state, unit),
      );
      return opts;
    }
    case 'end': {
      const opts: UnitOption[] = [];
      const awakens = replacementHandle(scenario, unit)
        ? landAwakensTargets(scenario, state, unit.owner)
        : [];
      if (awakens.length > 0) {
        opts.push({ t: 'command', command: 'landAwakens', cost: 1, targets: awakens });
      }
      const targets = powerThroughTargets(scenario, state, unit);
      if (targets.length > 0) {
        opts.push({ t: 'command', command: 'powerThrough', cost: 1, targets });
      }
      if (canUseEruptionOfFury(scenario, state, unit)) {
        opts.push({
          t: 'ability',
          abilityId: 'eruption-of-fury',
          name: 'Eruption of Fury',
          kind: 'activated',
          targets: eruptionOfFuryTargets(scenario, state, unit).map((u) => u.id),
          maxRageDice: Math.min(MAX_ERUPTION_RAGE_DICE, state.players[unit.owner].rageDice ?? 0),
          weapons: profileOf(scenario, unit)
            .weapons.filter((w) => w.kind === 'melee')
            .map((w) => ({ id: w.id, name: w.name })),
        });
      }
      return opts;
    }
    default:
      return [];
  }
}

export function targetOptions(
  scenario: Scenario,
  state: GameState,
  unitId: UnitId,
  mode: AttackMode,
): WeaponTargets[] {
  const unit = state.units[unitId];
  return unit ? weaponTargets(scenario, state, unit, mode) : [];
}

export function checkPlacement(
  scenario: Scenario,
  state: GameState,
  placement: Placement,
): Violation[] {
  const d = decision(scenario, state);
  if (!d || d.kind !== 'place') {
    return [{ code: 'BLOCKED', message: 'No unit is being placed right now.' }];
  }
  if (placement.unit !== d.unit) {
    return [{ code: 'WRONG_MODELS', message: 'That is not the unit being placed.' }];
  }
  if (d.reason === 'deploy') {
    return checkDeployPlacement(scenario, state, unitById(state, d.unit), placement);
  }
  if (d.reason === 'setUp') {
    return checkWyldwoodSetUp(scenario, state, unitById(state, d.unit), placement);
  }
  const top = state.stack[state.stack.length - 1];
  const moving = unitById(state, d.unit);
  const chargeLimit = d.reason === 'charge' ? chargeRestriction(scenario, state, moving) : null;
  const base = checkMovePlacement(scenario, state, moving, placement, {
    reason: d.reason,
    allowance: d.allowance,
    ...(top?.t === 'place' && top.caster ? { caster: top.caster } : {}),
    ...(top?.t === 'place' && top.minEnemyGap !== undefined
      ? { minEnemyGap: top.minEnemyGap }
      : {}),
    ...(top?.t === 'place' && top.engagedWith ? { engagedWith: top.engagedWith } : {}),
    ...(chargeLimit ? { chargeOnly: chargeLimit } : {}),
  });
  if (top?.t === 'place' && top.relocate && !base.some((v) => v.code === 'WRONG_MODELS')) {
    return [...base, ...relocateViolations(scenario, state, moving, placement, top.relocate)];
  }
  return base;
}

/**
 * The start-of-combat offers still valid when shown: an earlier Rhythm of the Chase may have
 * destroyed or moved the enemy a later offer (Fury of The Forest, the defender's Rhythm) relied on.
 */
function startOfCombatOptions(
  scenario: Scenario,
  state: GameState,
  options: ReactionOption[],
): ReactionOption[] {
  return options.flatMap((o) => {
    const unit = state.units[o.unit];
    if (!unit) return [];
    if (o.ability === 'rhythmOfTheChase') {
      const targets = rhythmTargets(scenario, state, unit);
      return targets.length > 0 ? [{ ...o, targets }] : [];
    }
    if (o.command === 'furyOfTheForest') {
      return canFuryOfTheForest(scenario, state, unit) ? [o] : [];
    }
    return [o];
  });
}
