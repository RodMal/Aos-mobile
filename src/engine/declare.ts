import { magicOptionsForUnit } from './abilities/magic.js';
import { checkAllocations, weaponTargets } from './combat.js';
import { illegal, type Ctx } from './ctx.js';
import { PILE_IN_DISTANCE } from './movement.js';
import { opponent } from './query.js';
import { canUsePlaceOfPower } from './terrain.js';
import { type Action, type PlayerId, type UnitId } from './types.js';
import { currentFightTier, eligibleFighters } from './eligibility.js';
import { advancePhase } from './turns.js';
import { unitOptions } from './decisions.js';
import { startAttacks } from './placing.js';
import { offerEndOfPhaseReaction } from './reactions.js';

export function declareShoot(ctx: Ctx, action: Extract<Action, { t: 'shoot' }>): void {
  const { s } = ctx;
  const unit = s.units[action.unit];
  if (!unit || !unitOptions(ctx.scenario, s, action.unit).some((o) => o.t === 'shoot')) {
    illegal('That unit cannot shoot now.');
  }
  if (action.allocations.length === 0) illegal('Pick a target for at least one weapon.');
  checkAllocations(weaponTargets(ctx.scenario, s, unit, 'shoot'), action.allocations);
  unit.shot = true;
  startAttacks(ctx, unit, 'shoot', action.allocations, action.allOutAttack ?? false);
}

export function declareFight(ctx: Ctx, player: PlayerId, unitId: UnitId): void {
  const { s } = ctx;
  if (!eligibleFighters(ctx.scenario, s, player).some((u) => u.id === unitId)) {
    illegal('That unit cannot fight now.');
  }
  const tier = currentFightTier(ctx.scenario, s);
  s.units[unitId]!.fought = true;
  s.fightTier = tier;
  s.fightPicker = opponent(player);
  s.stack.push({ t: 'targets', unit: unitId, mode: 'fight' });
  s.stack.push({
    t: 'place',
    unit: unitId,
    reason: 'pileIn',
    allowance: PILE_IN_DISTANCE,
    dice: [],
  });
}

export function declareTargets(ctx: Ctx, action: Extract<Action, { t: 'targets' }>): void {
  const { s } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (frame?.t !== 'targets') illegal('No unit is choosing targets.');
  const unit = s.units[frame.unit]!;
  checkAllocations(weaponTargets(ctx.scenario, s, unit, frame.mode), action.allocations);
  s.stack.pop();
  if (action.allocations.length === 0) {
    if (action.allOutAttack) illegal('All-out Attack needs at least one attack.');
    return;
  }
  startAttacks(ctx, unit, frame.mode, action.allocations, action.allOutAttack ?? false);
}

/** Settle completed helper frames (`targets` with no enemies, or `endPhase` after reactions). */
export function settle(ctx: Ctx): void {
  const { s } = ctx;
  for (;;) {
    const top = s.stack[s.stack.length - 1];
    if (!top) break;
    if (
      top.t === 'targets' &&
      weaponTargets(ctx.scenario, s, s.units[top.unit]!, top.mode).length === 0
    ) {
      s.stack.pop();
      ctx.events.push({
        t: 'note',
        text: `${s.units[top.unit]!.name} has no enemy in range to attack.`,
      });
      continue;
    }
    if (
      top.t === 'magicalIntervention' &&
      magicOptionsForUnit(ctx.scenario, s, s.units[top.unit]!).length === 0
    ) {
      const u = s.units[top.unit]!;
      u.magicalIntervention = false;
      s.stack.pop();
      continue;
    }
    if (top.t === 'placeOfPower') {
      const u = s.units[top.hero];
      if (!u || !canUsePlaceOfPower(ctx.scenario, s, u)) {
        s.stack.pop();
        continue;
      }
    }
    if (top.t === 'endPhase') {
      if (offerEndOfPhaseReaction(ctx)) {
        continue;
      }
      s.stack.pop();
      advancePhase(ctx);
      continue;
    }
    break;
  }
}
