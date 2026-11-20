import { addEffect, fireTriggers } from './abilities/effects.js';
import { SHADOWCREEP_ID } from './abilities/sylvaneth.js';
import { resolveAttacks } from './combat.js';
import { illegal, type Ctx } from './ctx.js';
import { allocateDamage, doomedByQueuedDamage, inflictMortalDamage } from './damage.js';
import { placementDistance } from './movement.js';
import { isFactionTerrainUnit, opponent, profileOf } from './query.js';
import { dwindling } from '../rules/factions/seasons.js';
import {
  type Allocation,
  type AttackMode,
  type Frame,
  type Placement,
  type ReactionOption,
  type UnitId,
  type UnitState,
} from './types.js';
import { commandBlocker } from './eligibility.js';
import { startRound } from './turns.js';
import { checkPlacement, unitOptions } from './decisions.js';
import { canHiddenHunters } from './reserve.js';
import { offerVenomiteToken } from './venomites.js';
import { rollAndPushCharge, useCommandOn } from './commands.js';

export function place(ctx: Ctx, placement: Placement): void {
  const { s } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (!frame || frame.t !== 'place') illegal('No unit is being placed right now.');
  const violations = checkPlacement(ctx.scenario, s, placement);
  if (violations.length > 0) illegal(violations[0]!.message, violations);
  const unit = s.units[frame.unit]!;
  const distance =
    frame.reason === 'summon' ||
    frame.reason === 'deploy' ||
    frame.reason === 'setUp' ||
    frame.reason === 'replacement' ||
    frame.reason === 'relocate'
      ? 0
      : placementDistance(unit, placement);
  for (const m of placement.models) {
    const model = unit.models[m.i]!;
    model.x = m.x;
    model.y = m.y;
    model.rot = m.rot;
  }
  if (frame.reason === 'deploy') {
    unit.status = 'battlefield';
    unit.setUpThisTurn = true;
  }
  if (frame.reason === 'normal' || frame.reason === 'run' || frame.reason === 'retreat') {
    // A Redeploy placement (a `normal` frame on a unit already marked as run) stays a run.
    if (!(frame.reason === 'normal' && unit.moved === 'run')) unit.moved = frame.reason;
  }
  if (frame.reason === 'charge') unit.charged = true;
  if (frame.reason === 'relocate') {
    // Chameleon Ambush: the unit leaves reserve and is on the battlefield from here.
    if (unit.status === 'reserve') {
      unit.status = 'battlefield';
      unit.inAmbush = false;
    }
    // Core 24.0: a unit set up other than in the deployment phase cannot use MOVE abilities in
    // the movement phase of the same turn (owner, 2026-11-20). A pile-in is not a MOVE ability.
    unit.setUpThisTurn = true;
    // Set up again: not a move. Merciless Ambush counts as a charge; Shadowcreep adds 1 to charges.
    if (frame.relocate?.kind === 'ambush') unit.charged = true;
    if (frame.relocate?.kind === 'shadowcreep') {
      addEffect(s, {
        id: SHADOWCREEP_ID,
        name: 'Shadowcreep',
        sourceUnit: unit.id,
        targetUnit: unit.id,
        owner: unit.owner,
        expires: 'turn',
      });
    }
  }
  if (frame.reason === 'replacement') {
    // The replacement is a new unit on the battlefield: it has done nothing this turn.
    unit.status = 'battlefield';
    unit.setUpThisTurn = true;
    unit.moved = null;
    unit.charged = false;
    unit.shot = false;
    unit.fought = false;
    unit.chargeDeclared = false;
    // Core 24.2: nothing the destroyed unit did or had carries over to the replacement.
    delete unit.declinedTerrainFight;
    delete unit.commandUsed;
    delete unit.allOutAttack;
    delete unit.castsUsed;
    delete unit.miscast;
    delete unit.ritualPoints;
    delete unit.abilitiesUsed;
    delete unit.magicalIntervention;
    delete unit.inAmbush;
    unit.enhancementsLost = true;
    const used = s.players[unit.owner].usedOncePerBattle;
    if (used)
      s.players[unit.owner].usedOncePerBattle = used.filter((u) => !u.startsWith(`${unit.id}:`));
    // A new unit: no effect on the unit it replaces carries over.
    if (s.effects) s.effects = s.effects.filter((e) => e.targetUnit !== unit.id);
    const damage = frame.replacement?.damage ?? 0;
    if (damage > 0) {
      // "Ward rolls cannot be made for those damage points": allocated as they are.
      const health = profileOf(ctx.scenario, unit).health;
      if (damage >= health) allocateDamage(ctx, unit, damage, 'The Goddess Of Life');
      else unit.damage = damage;
    }
    ctx.events.push({
      t: 'note',
      text: `${unit.name} is set up as a replacement unit${damage > 0 ? ` with ${damage} damage points` : ''}.`,
    });
  }
  s.stack.pop();
  if (frame.reason === 'deploy' && s.deploymentFinishedFirst == null) {
    const more = s.stack.some(
      (f) => f.t === 'place' && f.reason === 'deploy' && s.units[f.unit]?.owner === unit.owner,
    );
    if (!more) s.deploymentFinishedFirst = unit.owner;
  }
  ctx.events.push({ t: 'moved', unit: unit.id, kind: frame.reason, dice: frame.dice, distance });
  // A Sunblood Pack's player places its Venomites token next to it (R12).
  if (frame.reason === 'deploy') offerVenomiteToken(ctx, unit);
  if (frame.reason === 'deploy' && s.stack.length === 0) {
    startRound(ctx);
  }
  if (frame.reason === 'retreat' && dwindling(ctx.scenario, s, unit)) {
    ctx.events.push({ t: 'note', text: `The Dwindling: ${unit.name} retreats unharmed.` });
  } else if (frame.reason === 'retreat') {
    const roll = ctx.rng.int(1, 3);
    ctx.events.push({
      t: 'roll',
      player: unit.owner,
      label: 'Retreat (D3 mortal damage)',
      dice: [roll],
    });
    inflictMortalDamage(ctx, unit, roll, 'Retreat');
  }

  // "After a Move ability": normal moves, runs, retreats, charges and Power Through moves.
  // A pile-in has no Move keyword (owner's ruling, 2026-11-11), nor do set-ups.
  if (
    frame.reason !== 'summon' &&
    frame.reason !== 'deploy' &&
    frame.reason !== 'setUp' &&
    frame.reason !== 'replacement' &&
    frame.reason !== 'relocate' &&
    frame.reason !== 'pileIn' &&
    unit.status === 'battlefield' &&
    !doomedByQueuedDamage(ctx, unit)
  ) {
    fireTriggers(ctx, 'afterMove', {
      unit,
      moveKind:
        frame.reason === 'normal' || frame.reason === 'run' || frame.reason === 'retreat'
          ? frame.reason
          : undefined,
    });
  }
}

/**
 * Hidden Hunters, used in place of deploying the unit: it is set up in reserve in ambush and has
 * now been deployed (the deployment goes on as if it had been placed).
 */
export function hiddenHunters(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const frame = s.stack[s.stack.length - 1];
  const unit = s.units[unitId];
  if (
    !unit ||
    frame?.t !== 'place' ||
    frame.unit !== unitId ||
    !canHiddenHunters(ctx.scenario, s, unit)
  ) {
    illegal('That unit cannot use Hidden Hunters now.');
  }
  s.stack.pop();
  unit.inAmbush = true;
  if (s.deploymentFinishedFirst == null) {
    const more = s.stack.some(
      (f) => f.t === 'place' && f.reason === 'deploy' && s.units[f.unit]?.owner === unit.owner,
    );
    if (!more) s.deploymentFinishedFirst = unit.owner;
  }
  ctx.events.push({
    t: 'note',
    text: `${unit.name} is set up in reserve in ambush (Hidden Hunters).`,
  });
  if (s.stack.length === 0) startRound(ctx);
}

export function skipPlace(ctx: Ctx): void {
  const frame = ctx.s.stack.pop();
  if (frame?.t === 'place' && frame.reason === 'charge') {
    ctx.events.push({ t: 'note', text: `${ctx.s.units[frame.unit]!.name}'s charge fails.` });
  }
}

export function declareCharge(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  if (!unitOptions(ctx.scenario, s, unitId).some((o) => o.t === 'charge'))
    illegal('That unit cannot charge now.');
  const unit = s.units[unitId]!;
  unit.chargeDeclared = true;
  rollAndPushCharge(ctx, unit);
}

/** Pays for All-out Attack, then offers All-out Defence or resolves the attacks. */
export function startAttacks(
  ctx: Ctx,
  unit: UnitState,
  mode: AttackMode,
  allocations: Allocation[],
  allOutAttack: boolean,
  isCoveringFire = false,
): void {
  const { s } = ctx;
  if (allOutAttack) {
    useCommandOn(ctx, 'allOutAttack', unit);
    unit.allOutAttack = true;
  }
  const frame: Extract<Frame, { t: 'resolve' }> = {
    t: 'resolve',
    unit: unit.id,
    mode,
    allocations,
    allOutAttack,
    defended: [],
    ...(isCoveringFire ? { coveringFire: true } : {}),
  };
  const defender = opponent(unit.owner);
  const options: ReactionOption[] = [];
  for (const id of new Set(allocations.map((a) => a.target))) {
    const target = s.units[id]!;
    if (isFactionTerrainUnit(ctx.scenario, target)) continue; // terrain never acts (owner ruling)
    if (!commandBlocker(ctx.scenario, s, defender, 'allOutDefence', target)) {
      options.push({ command: 'allOutDefence', unit: id, cost: 1 });
    }
  }
  if (options.length > 0) {
    s.stack.push(frame);
    s.stack.push({ t: 'reaction', player: defender, options, trigger: `${mode}:${unit.id}` });
  } else {
    resolveAttacks(ctx, frame);
  }
}
