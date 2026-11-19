/**
 * The actions of the Sylvaneth set-up and charge abilities (task M4g); who may use them and the
 * limits on the new position are in `relocate.ts`.
 */
import { addEffect, unitGrants } from './abilities/effects.js';
import {
  GUARDIAN_OF_THE_GLADES_ID,
  HUNTMASTERS_STRIKE_ID,
  REALMROOT_GUIDE_ID,
  RHYTHM_OF_THE_CHASE_ID,
  SHADOWCREEP_ID,
} from './abilities/sylvaneth.js';
import { rollAndPushCharge, useCommandOn } from './commands.js';
import { d6, illegal, rollD3, type Ctx } from './ctx.js';
import { unitOptions } from './decisions.js';
import { inflictMortalDamage } from './damage.js';
import {
  battleKey,
  canHuntmaster,
  canMercilessAmbush,
  relocateGap,
  rhythmTargets,
  SET_UP_ABILITY_IDS,
} from './relocate.js';
import type { Action, Frame, PlayerState, Relocation, UnitId, UnitState } from './types.js';

type AbilityAction = Extract<Action, { t: 'ability' }>;

const snapshot = (p: PlayerState): PlayerState => JSON.parse(JSON.stringify(p)) as PlayerState;

function markUsedThisTurn(ctx: Ctx, unit: UnitState, id: string): void {
  const p = ctx.s.players[unit.owner];
  p.usedOncePerTurn = [...(p.usedOncePerTurn ?? []), id];
}

function pushSetUp(ctx: Ctx, unit: UnitState, relocate: Relocation): void {
  ctx.s.stack.push({
    t: 'place',
    unit: unit.id,
    reason: 'relocate',
    allowance: 0,
    dice: [],
    minEnemyGap: relocateGap(relocate.kind),
    relocate,
  });
}

/** Huntmaster's Strike, answering the reaction offered at the end of the turn. */
export function huntmastersStrike(ctx: Ctx, unitId: UnitId): void {
  const unit = ctx.s.units[unitId];
  if (!unit || !canHuntmaster(ctx.scenario, ctx.s, unit)) {
    illegal("That unit cannot use Huntmaster's Strike now.");
  }
  const undo = snapshot(ctx.s.players[unit.owner]);
  markUsedThisTurn(ctx, unit, HUNTMASTERS_STRIKE_ID);
  pushSetUp(ctx, unit, { kind: 'huntmaster', undo });
}

/** Rhythm of the Chase: D3 mortal damage on a 2+, then the unit may be set up within 1" of the target. */
export function rhythmOfTheChase(ctx: Ctx, unitId: UnitId, targetId?: UnitId): void {
  const unit = ctx.s.units[unitId];
  if (!unit) illegal('Unknown unit.');
  const targets = rhythmTargets(ctx.scenario, ctx.s, unit);
  if (targets.length === 0) illegal('That unit cannot use Rhythm of the Chase now.');
  const chosen = targetId ?? targets[0]!;
  if (!targets.includes(chosen)) illegal('Pick an enemy unit in combat with this unit.');
  const target = ctx.s.units[chosen]!;
  markUsedThisTurn(ctx, unit, RHYTHM_OF_THE_CHASE_ID);
  const roll = rollD3(ctx, unit.owner, 'Rhythm of the Chase');
  if (roll < 2) return;
  inflictMortalDamage(ctx, target, roll, 'Rhythm of the Chase');
  if (unit.status === 'battlefield' && target.status === 'battlefield') {
    pushSetUp(ctx, unit, { kind: 'rhythm', target: target.id });
  }
}

/** Shadowcreep: set up again wholly within 3" of terrain, more than 9" from enemies. */
export function shadowcreep(ctx: Ctx, unitId: UnitId): void {
  const unit = ctx.s.units[unitId]!;
  const undo = snapshot(ctx.s.players[unit.owner]);
  markUsedThisTurn(ctx, unit, SHADOWCREEP_ID);
  pushSetUp(ctx, unit, { kind: 'shadowcreep', undo });
}

/** Realmroot Guide: this unit and up to 1 other are set up again within the creeping overgrowth. */
export function realmrootGuide(ctx: Ctx, unitId: UnitId, otherId?: UnitId): void {
  const unit = ctx.s.units[unitId]!;
  const undo = snapshot(ctx.s.players[unit.owner]);
  const p = ctx.s.players[unit.owner];
  p.usedOncePerBattle = [...(p.usedOncePerBattle ?? []), battleKey(unit, REALMROOT_GUIDE_ID)];
  // The other unit is set up second, so it is pushed first; the undo is on this unit's frame.
  if (otherId) pushSetUp(ctx, ctx.s.units[otherId]!, { kind: 'realmroot' });
  pushSetUp(ctx, unit, { kind: 'realmroot', undo });
}

/** Guardian Of The Glades: +2 to the charge roll, and the charge must reach a marked enemy. */
export function guardianOfTheGlades(ctx: Ctx, unitId: UnitId): void {
  const unit = ctx.s.units[unitId]!;
  markUsedThisTurn(ctx, unit, GUARDIAN_OF_THE_GLADES_ID);
  addEffect(ctx.s, {
    id: GUARDIAN_OF_THE_GLADES_ID,
    name: 'Guardian Of The Glades',
    sourceUnit: unit.id,
    targetUnit: unit.id,
    owner: unit.owner,
    expires: 'turn',
  });
  unit.chargeDeclared = true;
  rollAndPushCharge(ctx, unit);
}

/**
 * Merciless Ambush: a charge roll of 2D6, then the unit may be set up again within 1/2" of an
 * enemy unit and wholly within X" of a terrain feature with an overgrown token (X: the roll).
 */
export function mercilessAmbush(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit || !canMercilessAmbush(ctx.scenario, s, unit)) {
    illegal('That unit cannot use Merciless Ambush now.');
  }
  useCommandOn(ctx, 'mercilessAmbush', unit);
  const dice: [number, number] = [d6(ctx), d6(ctx)];
  const mod = unitGrants(ctx.scenario, s, unit).chargeRollModifier;
  const roll = Math.max(0, dice[0] + dice[1] + mod);
  unit.chargeDeclared = true;
  ctx.events.push({ t: 'chargeRoll', unit: unit.id, dice, success: roll > 0 });
  if (roll > 0) pushSetUp(ctx, unit, { kind: 'ambush', reach: roll });
}

/** The ability actions that start in the movement and charge phases (one `ability` action). */
export function useSetUpAbility(ctx: Ctx, action: AbilityAction): void {
  if (!SET_UP_ABILITY_IDS.includes(action.abilityId)) illegal('Unknown ability.');
  const options = unitOptions(ctx.scenario, ctx.s, action.unit).filter(
    (o) => o.t === 'ability' && o.abilityId === action.abilityId,
  );
  if (options.length === 0) illegal('That ability cannot be used now.');
  if (action.abilityId === SHADOWCREEP_ID) shadowcreep(ctx, action.unit);
  else if (action.abilityId === GUARDIAN_OF_THE_GLADES_ID) guardianOfTheGlades(ctx, action.unit);
  else {
    const companions = options.flatMap((o) => (o.t === 'ability' ? o.targets : []));
    if (action.target && !companions.includes(action.target)) {
      illegal('Realmroot Guide takes a friendly Sylvaneth unit within this unit’s combat range.');
    }
    realmrootGuide(ctx, action.unit, action.target);
  }
}

/** Passing a set-up: the unit stays where it is; where the ability allows it, the use is taken back. */
export function undoRelocation(ctx: Ctx, frame: Extract<Frame, { t: 'place' }>): void {
  const undo = frame.relocate?.undo;
  if (!undo) return;
  ctx.s.players[ctx.s.units[frame.unit]!.owner] = snapshot(undo);
  // Realmroot Guide: the other unit's set-up goes with it.
  const next = ctx.s.stack[ctx.s.stack.length - 1];
  if (
    frame.relocate?.kind === 'realmroot' &&
    next?.t === 'place' &&
    next.relocate?.kind === 'realmroot'
  ) {
    ctx.s.stack.pop();
  }
}
