import { COMMANDS } from '../rules/core/commands.js';
import { answerCastReaction, resolvePendingSpell } from './abilities/magic.js';
import {
  FIGHT_THROUGH_THE_PAIN_ID,
  allocateOne,
  allocatePending,
  resolveAttacks,
} from './combat.js';
import { GLAMOURWEAVE_REROLL_ID, HUNTMASTERS_STRIKE_ID } from './abilities/sylvaneth.js';
import { huntmastersStrike, mercilessAmbush } from './relocating.js';
import { illegal, type Ctx } from './ctx.js';
import { opponent, unitsOf } from './query.js';
import { spendRageToNegateDamage } from '../rules/core/fury.js';
import {
  type Action,
  type CommandId,
  type Frame,
  type ReactionOption,
  type UnitId,
} from './types.js';
import {
  canCounterCharge,
  canMagicalIntervention,
  canRally,
  canRedeploy,
  coveringFireAllocations,
  powerThroughTargets,
} from './eligibility.js';
import {
  counterCharge,
  coveringFire,
  magicalIntervention,
  furyOfTheForest,
  powerThrough,
  rally,
  redeploy,
  useCommandOn,
} from './commands.js';

export function answerReaction(ctx: Ctx, action: Action): void {
  const { s } = ctx;
  const reaction = s.stack[s.stack.length - 1];
  if (reaction?.t !== 'reaction') illegal('There is no reaction to answer.');

  const under = s.stack[s.stack.length - 2];

  // 0. A Glamourweave re-roll: re-roll this failed roll, or keep it for a later one.
  if (under?.t === 'resolve' && reaction.options.some((o) => o.ability === 'glamourweave')) {
    let reroll: boolean;
    if (action.t === 'pass') reroll = false;
    else if (action.t === 'ability' && action.abilityId === GLAMOURWEAVE_REROLL_ID) reroll = true;
    else illegal('Re-roll the failed roll or keep it.');
    s.stack.pop(); // reaction
    const frame = s.stack.pop() as Extract<Frame, { t: 'resolve' }>;
    resolveAttacks(ctx, { ...frame, choices: [...(frame.choices ?? []), reroll] });
    return;
  }

  // 0b. Celestial Conduit and Coatl Familiar, offered when a spell is declared.
  if (under?.t === 'castReact') {
    answerCastReaction(ctx, action);
    return;
  }

  // 1. Unbind reaction to a pending spell
  if (under?.t === 'spell') {
    if (action.t === 'ability' && action.abilityId === 'unbind') {
      const ok = reaction.options.some((o) => o.ability === 'unbind' && o.unit === action.unit);
      if (!ok) illegal('That unit cannot unbind this spell.');
      s.stack.pop(); // reaction
      const spellFrame = s.stack.pop() as Extract<Frame, { t: 'spell' }>;
      resolvePendingSpell(ctx, spellFrame, action.unit);
      return;
    }
    if (action.t === 'pass') {
      s.stack.pop(); // reaction
      const spellFrame = s.stack.pop() as Extract<Frame, { t: 'spell' }>;
      resolvePendingSpell(ctx, spellFrame);
      return;
    }
    illegal('Unbind the spell or pass.');
  }

  // 2. All-out Defence reaction to pending attacks
  if (under?.t === 'resolve') {
    let defended: UnitId[] = [];
    if (action.t === 'command') {
      const ok = reaction.options.some(
        (o) => o.command === action.command && o.unit === action.unit,
      );
      if (!ok) illegal('That reaction is not available.');
      useCommandOn(ctx, 'allOutDefence', s.units[action.unit]!);
      defended = [action.unit];
    } else if (action.t !== 'pass') {
      illegal('Use a reaction or pass.');
    }
    s.stack.pop();
    const pending = s.stack.pop() as Extract<Frame, { t: 'resolve' }>;
    resolveAttacks(ctx, { ...pending, defended });
    return;
  }

  // 3. Fight Through the Pain before attack damage is allocated
  if (under?.t === 'allocate') {
    const option = reaction.options.find((o) => o.ability === 'fightThroughThePain')!;
    const incoming = option.damage ?? 0;
    let amount = incoming;
    if (action.t === 'ability' && action.abilityId === FIGHT_THROUGH_THE_PAIN_ID) {
      if (action.unit !== option.unit) illegal('Fight Through the Pain protects the unit hit.');
      const max = option.maxRageDice ?? 0;
      const dice = action.rageDice ?? max;
      if (!Number.isInteger(dice) || dice < 1 || dice > max) {
        illegal(`Spend between 1 and ${max} rage dice on Fight Through the Pain.`);
      }
      amount -= spendRageToNegateDamage(ctx, reaction.player, incoming, dice).damageNegated;
    } else if (action.t !== 'pass') {
      illegal('Spend rage dice on Fight Through the Pain, or take the damage.');
    }
    s.stack.pop(); // reaction
    const frame = s.stack.pop() as Extract<Frame, { t: 'allocate' }>;
    allocateOne(ctx, frame, amount);
    allocatePending(ctx, frame);
    return;
  }

  // 4. Phase / move command reactions (rally, redeploy, coveringFire, counterCharge, magicalIntervention, powerThrough)
  s.stack.pop(); // pop reaction frame (leaving `endPhase` on the stack if present)
  if (action.t === 'pass') {
    if (under?.t === 'endPhase') {
      s.reactionsOffered = [...(s.reactionsOffered ?? []), 'endPhasePassed'];
    }
    return;
  }
  if (action.t === 'ability' && action.abilityId === HUNTMASTERS_STRIKE_ID) {
    const ok = reaction.options.some(
      (o) => o.ability === 'huntmastersStrike' && o.unit === action.unit,
    );
    if (!ok) illegal('That reaction is not available.');
    huntmastersStrike(ctx, action.unit);
    return;
  }
  if (action.t === 'command') {
    const ok = reaction.options.some((o) => o.command === action.command && o.unit === action.unit);
    if (!ok) illegal('That reaction is not available.');
    executeReactionCommand(ctx, action.command, action.unit, action.target);
    return;
  }
  illegal('Use a reaction or pass.');
}

export function executeReactionCommand(
  ctx: Ctx,
  command: CommandId,
  unitId: UnitId,
  targetId?: UnitId,
): void {
  switch (command) {
    case 'rally':
      rally(ctx, unitId);
      break;
    case 'redeploy':
      redeploy(ctx, unitId);
      break;
    case 'coveringFire':
      coveringFire(ctx, unitId);
      break;
    case 'counterCharge':
      counterCharge(ctx, unitId);
      break;
    case 'magicalIntervention':
      magicalIntervention(ctx, unitId);
      break;
    case 'powerThrough':
      powerThrough(ctx, unitId, targetId);
      break;
    case 'furyOfTheForest':
      furyOfTheForest(ctx, unitId);
      break;
    case 'mercilessAmbush':
      mercilessAmbush(ctx, unitId);
      break;
    default:
      illegal(`Command ${command} cannot be used here.`);
  }
}

export function offerEndOfPhaseReaction(ctx: Ctx): boolean {
  const { s } = ctx;
  const nonActive = opponent(s.active);
  const offered = s.reactionsOffered ?? [];
  if (offered.includes('endPhasePassed')) return false;

  if (s.phase === 'hero') {
    const options: ReactionOption[] = [];
    for (const u of unitsOf(s, nonActive)) {
      if (canMagicalIntervention(ctx.scenario, s, u)) {
        options.push({
          command: 'magicalIntervention',
          unit: u.id,
          cost: COMMANDS.magicalIntervention.cost,
        });
      }
      if (canRally(ctx.scenario, s, u)) {
        options.push({
          command: 'rally',
          unit: u.id,
          cost: COMMANDS.rally.cost,
        });
      }
    }
    if (options.length > 0) {
      if (s.stack[s.stack.length - 1]?.t !== 'endPhase') {
        s.stack.push({ t: 'endPhase' });
      }
      s.stack.push({
        t: 'reaction',
        player: nonActive,
        options,
        trigger: 'phase:hero',
      });
      return true;
    }
  }

  if (s.phase === 'movement' && !offered.includes('redeploy')) {
    // Once, after the active player has finished all movement-phase activations.
    const units = unitsOf(s, nonActive).filter((u) => canRedeploy(ctx.scenario, s, u));
    if (units.length > 0) {
      s.reactionsOffered = [...offered, 'redeploy'];
      s.stack.push({ t: 'endPhase' });
      s.stack.push({
        t: 'reaction',
        player: nonActive,
        options: units.map((u) => ({
          command: 'redeploy',
          unit: u.id,
          cost: COMMANDS.redeploy.cost,
        })),
        trigger: 'phase:movement',
      });
      return true;
    }
  }

  if (s.phase === 'shooting' && !offered.includes('coveringFire')) {
    const turnHadActivity = unitsOf(s, s.active).some(
      (u) => u.moved !== null || u.shot || (u.castsUsed ?? 0) > 0,
    );
    if (turnHadActivity) {
      const units = unitsOf(s, nonActive).filter(
        (u) => coveringFireAllocations(ctx.scenario, s, u).length > 0,
      );
      if (units.length > 0) {
        s.reactionsOffered = [...offered, 'coveringFire'];
        s.stack.push({ t: 'endPhase' });
        s.stack.push({
          t: 'reaction',
          player: nonActive,
          options: units.map((u) => ({
            command: 'coveringFire',
            unit: u.id,
            cost: COMMANDS.coveringFire.cost,
          })),
          trigger: 'phase:shooting',
        });
        return true;
      }
    }
  }

  if (s.phase === 'charge' && !offered.includes('counterCharge')) {
    const units = unitsOf(s, nonActive).filter((u) => canCounterCharge(ctx.scenario, s, u));
    if (units.length > 0) {
      s.reactionsOffered = [...offered, 'counterCharge'];
      s.stack.push({ t: 'endPhase' });
      s.stack.push({
        t: 'reaction',
        player: nonActive,
        options: units.map((u) => ({
          command: 'counterCharge',
          unit: u.id,
          cost: COMMANDS.counterCharge.cost,
        })),
        trigger: 'phase:charge',
      });
      return true;
    }
  }

  if (s.phase === 'end' && !offered.includes('powerThrough')) {
    const units = unitsOf(s, nonActive).filter(
      (u) => powerThroughTargets(ctx.scenario, s, u).length > 0,
    );
    if (units.length > 0) {
      s.reactionsOffered = [...offered, 'powerThrough'];
      s.stack.push({ t: 'endPhase' });
      s.stack.push({
        t: 'reaction',
        player: nonActive,
        options: units.map((u) => ({
          command: 'powerThrough',
          unit: u.id,
          cost: COMMANDS.powerThrough.cost,
        })),
        trigger: 'phase:end',
      });
      return true;
    }
  }

  return false;
}
