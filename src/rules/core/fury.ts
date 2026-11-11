/**
 * GHB 2026-27 "Scourge of Aqshy" Fury & Rage Season Rules (GHB 2026-27 Season Rules, p. 13).
 *
 * Rules verbatim:
 * - Raising the Heat: Attacker sets fury level to 1; defender sets it to 2.
 * - Simmering Rage (mandatory, Start of Battle Round): Unspent rage dice are discarded, then
 *   each player gains rage dice equal to their fury level (0..7). Fury does not rise on its own.
 * - Eruption of Fury (Once Per Turn (Army), End of Any Turn):
 *   Pick a friendly unit and an enemy unit in combat with it. Pick 1 melee weapon and spend
 *   up to 3 rage dice; resolve that many combat attacks with it. Critical hits disabled.
 *   Each unmodified 6: D3 mortal damage to EACH enemy unit in combat with the user, and the
 *   opponent increases fury by 1 (max 7).
 *   Each unmodified 1: D3 mortal damage to the user (no ward).
 * - Fight Through the Pain (Passive, before damage allocation):
 *   Spend any number of rage dice. For each, reduce fury level by 1 (min 0) and roll a D6;
 *   on a 3+ remove 1 damage point from that unit's damage pool.
 */
import type { Weapon } from '../../data/profile.js';
import type { Ctx } from '../../engine/ctx.js';
import { rollD3, rollD6 } from '../../engine/ctx.js';
import { allocateDamage, inflictMortalDamage } from '../../engine/damage.js';
import { rollAttackSequence, rollWard } from '../../engine/attack.js';
import { enemiesInCombat, inCombat, opponent, profileOf } from '../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitState } from '../../engine/types.js';
import { attackModifiers, sumModifiers } from './modifiers.js';
import { effectiveWard } from '../../engine/abilities/effects.js';

export const MIN_FURY_LEVEL = 0;
export const MAX_FURY_LEVEL = 7;
export const ATTACKER_STARTING_FURY = 1;
export const DEFENDER_STARTING_FURY = 2;
export const RAGE_DAMAGE_NEGATION_TARGET = 3;
export const MAX_ERUPTION_RAGE_DICE = 3;
export const ERUPTION_OF_FURY_ID = 'eruption-of-fury';

/** Initialises Fury levels and Rage pools for both players at game setup. */
export function initFury(state: GameState, attacker: PlayerId = 0): void {
  for (const p of [0, 1] as PlayerId[]) {
    const pState = state.players[p];
    pState.furyLevel = p === attacker ? ATTACKER_STARTING_FURY : DEFENDER_STARTING_FURY;
    pState.rageDice = 0;
    pState.furyUsedThisTurn = [];
  }
}

export function clampFury(level: number): number {
  return Math.min(MAX_FURY_LEVEL, Math.max(MIN_FURY_LEVEL, level));
}

/**
 * Simmering Rage: mandatory at the start of each battle round.
 * Discards unspent rage dice, then grants rage dice equal to the player's fury level.
 */
export function applySimmeringRage(state: GameState): void {
  for (const p of [0, 1] as PlayerId[]) {
    const pState = state.players[p];
    pState.furyLevel = clampFury(
      pState.furyLevel ?? (p === 0 ? ATTACKER_STARTING_FURY : DEFENDER_STARTING_FURY),
    );
    pState.rageDice = pState.furyLevel;
  }
}

/** True when `unit` can use Eruption of Fury against an enemy unit in combat. */
export function canUseEruptionOfFury(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): boolean {
  if (unit.status !== 'battlefield') return false;
  const pState = state.players[unit.owner];
  if ((pState.rageDice ?? 0) <= 0) return false;
  if ((pState.furyUsedThisTurn ?? []).includes(ERUPTION_OF_FURY_ID)) return false;
  if (!inCombat(scenario, state, unit)) return false;

  const profile = profileOf(scenario, unit);
  return profile.weapons.some((w) => w.kind === 'melee');
}

/** Enemy units eligible as targets for `unit` using Eruption of Fury. */
export function eruptionOfFuryTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitState[] {
  if (!canUseEruptionOfFury(scenario, state, unit)) return [];
  return enemiesInCombat(scenario, state, unit);
}

export interface EruptionResult {
  rageDiceSpent: number;
  damageToTarget: number;
  mortalDamageBySixes: number;
  selfMortalDamage: number;
  opponentFuryGained: number;
}

/**
 * Resolves `Eruption of Fury` (GHB 2026-27 Season Rules, p. 13).
 *
 * Spends up to 3 rage dice to make combat attacks with `weapon`.
 * Critical hits are switched off.
 * - Each unmodified 6: D3 mortal damage to each enemy unit in combat with `unit`, and opponent fury +1.
 * - Each unmodified 1: D3 mortal damage to `unit` (no ward rolls permitted).
 */
export function resolveEruptionOfFury(
  ctx: Ctx,
  unit: UnitState,
  target: UnitState,
  weapon: Weapon,
  diceToSpend: number,
): EruptionResult {
  const { scenario, s } = ctx;
  const player = unit.owner;
  const opp = opponent(player);
  const pState = s.players[player];
  const oppState = s.players[opp];

  const available = pState.rageDice ?? 0;
  const spent = Math.max(1, Math.min(diceToSpend, MAX_ERUPTION_RAGE_DICE, available));
  pState.rageDice = Math.max(0, available - spent);
  pState.furyUsedThisTurn = [...(pState.furyUsedThisTurn ?? []), ERUPTION_OF_FURY_ID];

  // Attack sequence: critical hits disabled
  const weaponWithoutCrits: Weapon = {
    ...weapon,
    abilities: weapon.abilities.filter(
      (a) => a.t !== 'critAutoWound' && a.t !== 'critMortal' && a.t !== 'crit2Hits',
    ),
  };

  const mods = sumModifiers(
    attackModifiers(scenario, s, {
      attacker: unit,
      target,
      weapon: weaponWithoutCrits,
      mode: 'fight',
    }),
    weaponWithoutCrits,
  );

  const tp = profileOf(scenario, target);
  const targetWard = effectiveWard(scenario, s, target) ?? null;

  const attackSeq = rollAttackSequence(ctx.rng, {
    weapon: weaponWithoutCrits,
    attacks: spent,
    mods,
    target: { save: tp.save, ward: targetWard },
  });

  const hitRolls = attackSeq.dice.hit;
  const sixes = hitRolls.filter((d) => d === 6).length;
  const ones = hitRolls.filter((d) => d === 1).length;

  // Allocate damage to target from successful attacks
  const targetWardRoll = rollWard(ctx.rng, attackSeq.damage + attackSeq.mortal, targetWard);
  const damageToTarget = targetWardRoll.taken;
  if (damageToTarget > 0) {
    allocateDamage(ctx, target, damageToTarget, `${unit.name} (Eruption of Fury)`);
  }

  // 6s: D3 mortal damage to EACH enemy unit in combat with user, and opponent gains +1 fury per 6
  let mortalDamageBySixes = 0;
  let opponentFuryGained = 0;
  if (sixes > 0) {
    opponentFuryGained = sixes;
    oppState.furyLevel = clampFury((oppState.furyLevel ?? 0) + sixes);

    const engagedEnemies = enemiesInCombat(scenario, s, unit);
    for (const enemy of engagedEnemies) {
      let dmgForEnemy = 0;
      for (let k = 0; k < sixes; k++) {
        dmgForEnemy += rollD3(ctx, player, 'Eruption of Fury (6s)');
      }
      inflictMortalDamage(ctx, enemy, dmgForEnemy, `${unit.name} (Eruption of Fury 6s)`);
      mortalDamageBySixes += dmgForEnemy;
    }
  }

  // 1s: D3 mortal damage to user per 1 (no ward allowed)
  let selfMortalDamage = 0;
  if (ones > 0) {
    for (let k = 0; k < ones; k++) {
      selfMortalDamage += rollD3(ctx, player, 'Eruption of Fury (1s)');
    }
    // Allocate directly without ward roll
    allocateDamage(ctx, unit, selfMortalDamage, `${unit.name} (Eruption of Fury 1s)`);
  }

  ctx.events.push({
    t: 'note',
    text:
      `${unit.name} erupts with ${weapon.name}: spent ${spent} rage dice, dealt ${damageToTarget} damage to ${target.name}` +
      (sixes > 0
        ? `, ${sixes} six(es) inflicted ${mortalDamageBySixes} mortal damage on engaged enemies and raised opponent fury by ${sixes}`
        : '') +
      (ones > 0 ? `, ${ones} one(s) dealt ${selfMortalDamage} mortal damage to self` : ''),
  });

  return {
    rageDiceSpent: spent,
    damageToTarget,
    mortalDamageBySixes,
    selfMortalDamage,
    opponentFuryGained,
  };
}

/**
 * Fight Through the Pain (Passive):
 * Before allocating damage to a friendly unit, spend rage dice.
 * For each die spent:
 * - Reduce player's fury level by 1 (min 0)
 * - Roll a D6; on a 3+, remove 1 damage point.
 *
 * Returns the number of damage points negated.
 */
export function spendRageToNegateDamage(
  ctx: Ctx,
  player: PlayerId,
  incomingDamage: number,
  maxDiceToSpend?: number,
): { damageNegated: number; diceSpent: number; rolls: number[] } {
  const pState = ctx.s.players[player];
  const availableDice = pState.rageDice ?? 0;
  if (availableDice <= 0 || incomingDamage <= 0) {
    return { damageNegated: 0, diceSpent: 0, rolls: [] };
  }

  const spendLimit =
    maxDiceToSpend !== undefined ? Math.min(maxDiceToSpend, availableDice) : availableDice;
  let damageNegated = 0;
  let diceSpent = 0;
  const rolls: number[] = [];

  for (let i = 0; i < spendLimit && damageNegated < incomingDamage; i++) {
    diceSpent++;
    pState.furyLevel = Math.max(MIN_FURY_LEVEL, (pState.furyLevel ?? 0) - 1);
    const roll = rollD6(ctx);
    rolls.push(roll);
    if (roll >= RAGE_DAMAGE_NEGATION_TARGET) {
      damageNegated++;
    }
  }

  pState.rageDice = Math.max(0, availableDice - diceSpent);

  if (diceSpent > 0) {
    ctx.events.push({
      t: 'roll',
      player,
      label: 'Fight Through the Pain',
      dice: rolls,
    });
    ctx.events.push({
      t: 'note',
      text: `Player ${player + 1} spends ${diceSpent} rage dice (Fight Through the Pain) — ${damageNegated} damage negated, fury now ${pState.furyLevel}.`,
    });
  }

  return { damageNegated, diceSpent, rolls };
}
