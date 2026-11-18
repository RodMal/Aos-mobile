import { rallyPoints, rallySpend, RALLY_ROLLS } from '../rules/core/rally.js';
import { unitGrants } from './abilities/effects.js';
import { d6, d6s, illegal, rollD3, type Ctx } from './ctx.js';
import { inflictMortalDamage, returnPosition } from './damage.js';
import {
  CHARGE_END_RANGE,
  enemiesInCombat,
  opponent,
  profileOf,
  unitById,
  unitsOf,
  unitsWithin,
} from './query.js';
import { WYLDWOOD_SETUP_ID, nextWyldwoodPiece, suggestWyldwoodSetUp } from './wyldwood.js';
import { type CommandId, type MoveKind, type UnitId, type UnitState } from './types.js';
import {
  canCounterCharge,
  canMagicalIntervention,
  canRally,
  canRedeploy,
  commandBlocker,
  coveringFireAllocations,
  payCommand,
  powerThroughTargets,
} from './eligibility.js';
import { unitOptions } from './decisions.js';
import { startAttacks } from './placing.js';

// ─── Actions ──────────────────────────────────────────────────────────────────

export function useCommandOn(ctx: Ctx, command: CommandId, unit: UnitState): void {
  const blocker = commandBlocker(ctx.scenario, ctx.s, unit.owner, command, unit);
  if (blocker) illegal(blocker);
  payCommand(ctx.scenario, ctx.s, unit.owner, command, unit);
  ctx.events.push({ t: 'command', player: unit.owner, command, unit: unit.id });
}

export function declareMove(ctx: Ctx, unitId: UnitId, kind: MoveKind, atTheDouble = false): void {
  const { s } = ctx;
  const option = unitOptions(ctx.scenario, s, unitId).find(
    (o) => o.t === 'move' && o.kind === kind,
  );
  if (!option || option.t !== 'move') illegal(`That unit cannot ${kind} now.`);
  const unit = s.units[unitId]!;
  const dice: number[] = [];
  let allowance = option.allowance;
  if (atTheDouble) {
    if (kind !== 'run') illegal('At the Double is used with a run.');
    useCommandOn(ctx, 'atTheDouble', unit);
    dice.push(6);
    allowance += 6;
    unit.moved = 'run';
  } else if (kind === 'run') {
    const roll = d6(ctx);
    dice.push(roll);
    allowance += roll;
    // A run is committed once the die is rolled, whether or not the unit then moves.
    unit.moved = 'run';
    ctx.events.push({ t: 'roll', player: s.active, label: 'Run', dice: [roll] });
  }
  s.stack.push({ t: 'place', unit: unitId, reason: kind, allowance, dice });
}

export function rally(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit || !canRally(ctx.scenario, s, unit)) illegal('That unit cannot rally now.');
  useCommandOn(ctx, 'rally', unit);
  const dice = d6s(ctx, RALLY_ROLLS);
  ctx.events.push({ t: 'roll', player: unit.owner, label: 'Rally', dice });
  const health = profileOf(ctx.scenario, unit).health;
  const dead = unit.models.flatMap((m, i) => (m.alive ? [] : [i]));
  let points = rallyPoints(dice);
  const spend = rallySpend(points, health, dead.length, unit.damage);
  let returned = 0;
  for (const i of dead.slice(0, spend.returnModels)) {
    const at = returnPosition(ctx.scenario, s, unit, i);
    if (!at) break;
    Object.assign(unit.models[i]!, at, { alive: true });
    points -= health;
    returned++;
  }
  const healed = Math.min(points, unit.damage);
  unit.damage -= healed;
  ctx.events.push({
    t: 'note',
    text: `${unit.name} rallies: ${returned} model(s) returned, ${healed} damage healed.`,
  });
}

export function redeploy(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit || !canRedeploy(ctx.scenario, s, unit)) illegal('That unit cannot redeploy now.');
  useCommandOn(ctx, 'redeploy', unit);
  const roll = d6(ctx);
  ctx.events.push({ t: 'roll', player: unit.owner, label: 'Redeploy', dice: [roll] });
  // A Redeploy is a run ability (owner's ruling, 2026-11-12): the unit counts as having run.
  unit.moved = 'run';
  s.stack.push({ t: 'place', unit: unit.id, reason: 'normal', allowance: roll, dice: [roll] });
}

export function coveringFire(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit) illegal('Unknown unit.');
  const allocations = coveringFireAllocations(ctx.scenario, s, unit);
  if (allocations.length === 0) illegal('That unit cannot use Covering Fire now.');
  useCommandOn(ctx, 'coveringFire', unit);
  unit.shot = true;
  startAttacks(ctx, unit, 'shoot', allocations, false, true);
}

export function counterCharge(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit || !canCounterCharge(ctx.scenario, s, unit)) {
    illegal('That unit cannot use Counter-charge now.');
  }
  useCommandOn(ctx, 'counterCharge', unit);
  unit.chargeDeclared = true;
  rollAndPushCharge(ctx, unit);
}

export function magicalIntervention(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit || !canMagicalIntervention(ctx.scenario, s, unit)) {
    illegal('That unit cannot use Magical Intervention now.');
  }
  useCommandOn(ctx, 'magicalIntervention', unit);
  unit.magicalIntervention = true;
  s.stack.push({ t: 'magicalIntervention', unit: unit.id });
}

export function powerThrough(ctx: Ctx, unitId: UnitId, targetId?: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit) illegal('Unknown unit.');
  const targets = powerThroughTargets(ctx.scenario, s, unit);
  if (targets.length === 0) illegal('That unit cannot use Power Through now.');
  const chosenId = targetId ?? targets[0]!;
  if (!targets.includes(chosenId)) {
    illegal('Power Through must target an engaged enemy unit with a lower Health characteristic.');
  }
  const target = unitById(s, chosenId);
  useCommandOn(ctx, 'powerThrough', unit);
  const dmg = rollD3(ctx, unit.owner, 'Power Through (D3 mortal damage)');
  inflictMortalDamage(ctx, target, dmg, 'Power Through');
  const allowance = profileOf(ctx.scenario, unit).move;
  // It may stay in combat with the units it is in combat with now, but no others
  // (owner's ruling, 2026-11-11).
  const engagedWith = enemiesInCombat(ctx.scenario, s, unit).map((e) => e.id);
  s.stack.push({
    t: 'place',
    unit: unit.id,
    reason: 'powerThrough',
    allowance,
    dice: [],
    engagedWith,
  });
}

export function forwardToVictory(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId];
  if (!unit || !unit.chargeDeclared || unit.charged) {
    illegal('Forward to Victory can only be used after a charge roll.');
  }
  useCommandOn(ctx, 'forwardToVictory', unit);
  const top = s.stack[s.stack.length - 1];
  if (top?.t === 'place' && top.unit === unitId && top.reason === 'charge') {
    s.stack.pop();
  }
  rollAndPushCharge(ctx, unit);
}

export function rollAndPushCharge(ctx: Ctx, unit: UnitState): void {
  const { s } = ctx;
  const dice: [number, number] = [d6(ctx), d6(ctx)];
  const mod = unitGrants(ctx.scenario, s, unit).chargeRollModifier;
  const roll = Math.max(0, dice[0] + dice[1] + mod);
  const success =
    roll > 0 &&
    unitsOf(s, opponent(unit.owner)).some((e) =>
      unitsWithin(ctx.scenario, unit, e, roll + CHARGE_END_RANGE),
    );
  ctx.events.push({ t: 'chargeRoll', unit: unit.id, dice, success });
  if (success) {
    s.stack.push({ t: 'place', unit: unit.id, reason: 'charge', allowance: roll, dice });
  }
}

/** Hero phase: sets up a further Awakened Wyldwood at a suggested legal spot, then places it. */
export function setUpWyldwood(ctx: Ctx, handleId: UnitId): void {
  const { s } = ctx;
  const handle = s.units[handleId]!;
  if (
    !unitOptions(ctx.scenario, s, handleId).some(
      (o) => o.t === 'ability' && o.abilityId === WYLDWOOD_SETUP_ID,
    )
  ) {
    illegal('No further Awakened Wyldwood can be set up now.');
  }
  const piece = nextWyldwoodPiece(ctx.scenario, s, handle.owner);
  const spot = suggestWyldwoodSetUp(ctx.scenario, s, piece);
  if (!spot) illegal('There is no room to set up another Awakened Wyldwood.');
  const m = spot.models[0]!;
  piece.models[0] = { x: m.x, y: m.y, rot: m.rot, alive: true };
  s.units[piece.id] = piece;
  s.unitOrder.push(piece.id);
  s.players[handle.owner].wyldwoodSetUpTurn = `${s.round}:${s.turnIndex}`;
  s.stack.push({ t: 'place', unit: piece.id, reason: 'setUp', allowance: 0, dice: [] });
}

/** Cancels a pending Wyldwood set-up: the piece is taken away and may be set up later. */
export function cancelWyldwood(ctx: Ctx, unitId: UnitId): void {
  const { s } = ctx;
  const unit = s.units[unitId]!;
  s.units = Object.fromEntries(Object.entries(s.units).filter(([id]) => id !== unitId));
  s.unitOrder = s.unitOrder.filter((id) => id !== unitId);
  delete s.players[unit.owner].wyldwoodSetUpTurn;
}
