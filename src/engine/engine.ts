import { battleplanRules } from '../rules/battleplans/index.js';
import { clearPhaseCommands, commandBlocker, payCommand } from '../rules/core/commands.js';
import { resolveControl } from '../rules/core/objectives.js';
import { rallyPoints, rallySpend, RALLY_ROLLS } from '../rules/core/rally.js';
import { priorityWinner, roundCommandPoints, seizes } from '../rules/core/round.js';
import { checkAllocations, mayShoot, resolveAttacks, weaponTargets } from './combat.js';
import { d6, d6s, illegal, type Ctx } from './ctx.js';
import { inflictMortalDamage, returnPosition } from './damage.js';
import { checkMovePlacement, PILE_IN_DISTANCE, placementDistance } from './movement.js';
import {
  CHARGE_END_RANGE,
  enemiesWithin,
  inCombat,
  opponent,
  profileOf,
  unitById,
  unitsOf,
  unitsWithin,
} from './query.js';
import { RngCursor, rngFromSeed } from './rng.js';
import { deployArmies } from './setup.js';
import {
  PHASES,
  type Action,
  type Allocation,
  type AttackMode,
  type Decision,
  type Engine,
  type Frame,
  type GameState,
  type MoveKind,
  type Placement,
  type PlayerId,
  type ReactionOption,
  type Scenario,
  type StepResult,
  type UnitId,
  type UnitOption,
  type UnitState,
  type Violation,
  type WeaponTargets,
} from './types.js';

/** Command points each player receives at the start of a battle round (before the underdog). */
export const CP_PER_ROUND = 4;
/** The longest charge roll, plus the 1/2" a charge may end from its target. */
export const MAX_CHARGE_REACH = 12 + CHARGE_END_RANGE;

/** A deep copy of the state. `apply` clones once and then edits the copy freely. */
export function cloneState(state: GameState): GameState {
  const units: Record<UnitId, UnitState> = {};
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    units[id] = { ...u, models: u.models.map((m) => ({ ...m })) };
  }
  const player = (p: GameState['players'][number]): GameState['players'][number] => ({
    ...p,
    vpByRound: [...p.vpByRound],
    ...(p.commandsUsed ? { commandsUsed: [...p.commandsUsed] } : {}),
  });
  return {
    ...state,
    players: [player(state.players[0]), player(state.players[1])],
    units,
    unitOrder: [...state.unitOrder],
    objectives: state.objectives.map((o) => ({ ...o })),
    stack: state.stack.map((f) => ({ ...f })),
  };
}

// ─── Turn sequence ──────────────────────────────────────────────────────────────

function startTurn(ctx: Ctx): void {
  const { s } = ctx;
  for (const id of s.unitOrder) {
    const u = s.units[id]!;
    u.moved = null;
    u.charged = false;
    u.shot = false;
    u.fought = false;
    u.chargeDeclared = false;
    u.allOutAttack = false;
  }
  clearPhaseCommands(s);
  s.phase = 'hero';
  s.fightPicker = null;
  ctx.events.push({ t: 'turnStart', player: s.active, round: s.round });
  ctx.events.push({ t: 'phaseStart', phase: s.phase, player: s.active });
}

/** After priority: command points (with the underdog's extra point), then the first turn. */
function beginRound(ctx: Ctx): void {
  const { s } = ctx;
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].cp = roundCommandPoints(s, p);
    ctx.events.push({ t: 'commandPoints', player: p, cp: s.players[p].cp });
  }
  s.turnIndex = 0;
  s.active = s.firstPlayer;
  startTurn(ctx);
}

function startRound(ctx: Ctx): void {
  const { s } = ctx;
  ctx.events.push({ t: 'roundStart', round: s.round });
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].cp = 0;
    s.players[p].vpByRound.push(0);
  }
  if (s.round === 1) {
    // Round 1: the attacker (player 0) takes the first turn.
    s.firstPlayer = 0;
    beginRound(ctx);
    return;
  }
  const rolls: [number, number] = [d6(ctx), d6(ctx)];
  const winner = priorityWinner(rolls, s.firstPlayer);
  ctx.events.push({ t: 'priority', rolls, winner });
  s.stack.push({ t: 'priority', winner, rolls });
}

function choosePriority(ctx: Ctx, value: string): void {
  const { s } = ctx;
  const frame = s.stack.pop();
  if (frame?.t !== 'priority') illegal('There is no priority choice to make.');
  if (value !== 'first' && value !== 'second') illegal('Choose "first" or "second".');
  const first = value === 'first' ? frame.winner : opponent(frame.winner);
  if (seizes(s, frame.winner, s.firstPlayer, first)) {
    s.seizedBy = first;
    ctx.events.push({ t: 'note', text: `Player ${first + 1} seizes the initiative.` });
  }
  s.firstPlayer = first;
  beginRound(ctx);
}

function endGame(ctx: Ctx): void {
  const { s } = ctx;
  const [a, b] = [s.players[0].vp, s.players[1].vp];
  s.status = 'ended';
  s.winner = a === b ? 'draw' : a > b ? 0 : 1;
  ctx.events.push({ t: 'gameEnd', winner: s.winner, vp: [a, b] });
}

/** End of a turn: resolve objective control, then the player whose turn it was scores. */
function endTurn(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const change of resolveControl(scenario, s)) {
    s.objectives.find((o) => o.id === change.id)!.controller = change.controller;
    ctx.events.push({ t: 'objective', objective: change.id, controller: change.controller });
  }
  const player = s.active;
  for (const line of battleplanRules(scenario.battlefield.id).endOfTurnScore(s, player)) {
    s.players[player].vp += line.vp;
    s.players[player].vpByRound[s.round - 1] =
      (s.players[player].vpByRound[s.round - 1] ?? 0) + line.vp;
    ctx.events.push({ t: 'score', player, vp: line.vp, reason: line.reason });
  }
}

function advancePhase(ctx: Ctx): void {
  const { s, scenario } = ctx;
  clearPhaseCommands(s);
  const next = PHASES[PHASES.indexOf(s.phase) + 1];
  if (next) {
    s.phase = next;
    s.fightPicker = next === 'combat' ? s.active : null;
    ctx.events.push({ t: 'phaseStart', phase: next, player: s.active });
    return;
  }
  endTurn(ctx);
  if (s.turnIndex === 0) {
    s.turnIndex = 1;
    s.active = opponent(s.active);
    startTurn(ctx);
  } else if (s.round >= scenario.rounds) {
    endGame(ctx);
  } else {
    s.round += 1;
    startRound(ctx);
  }
}

// ─── Eligibility ────────────────────────────────────────────────────────────────

function moveOptions(scenario: Scenario, state: GameState, unit: UnitState): UnitOption[] {
  if (unit.moved !== null) return [];
  const profile = profileOf(scenario, unit);
  if (profile.move <= 0 && !profile.moveDice) return [];
  if (inCombat(scenario, state, unit)) {
    return [{ t: 'move', kind: 'retreat', allowance: profile.move }];
  }
  return [
    { t: 'move', kind: 'normal', allowance: profile.move },
    { t: 'move', kind: 'run', allowance: profile.move },
  ];
}

/** Units of `player` that may be picked to fight: in combat or charged, not yet fought. */
export function eligibleFighters(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  return unitsOf(state, player).filter(
    (u) => !u.fought && (u.charged || inCombat(scenario, state, u)),
  );
}

function canCharge(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (unit.chargeDeclared || unit.moved === 'run' || unit.moved === 'retreat') return false;
  if (inCombat(scenario, state, unit)) return false;
  return enemiesWithin(scenario, state, unit, MAX_CHARGE_REACH).length > 0;
}

function canRally(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(state, unit.owner, 'rally', unit)) return false;
  if (inCombat(scenario, state, unit)) return false;
  return unit.damage > 0 || unit.models.some((m) => !m.alive);
}

// ─── Engine ─────────────────────────────────────────────────────────────────────

export function createEngine(scenario: Scenario): Engine {
  function fightPickerFor(state: GameState): PlayerId | null {
    const first = state.fightPicker ?? state.active;
    if (eligibleFighters(scenario, state, first).length > 0) return first;
    const other = opponent(first);
    return eligibleFighters(scenario, state, other).length > 0 ? other : null;
  }

  function decision(state: GameState): Decision | null {
    if (state.status === 'ended') return null;
    const top = state.stack[state.stack.length - 1];
    if (top) {
      switch (top.t) {
        case 'priority':
          return { kind: 'priority', player: top.winner, rolls: top.rolls };
        case 'place':
          return {
            kind: 'place',
            player: unitById(state, top.unit).owner,
            unit: top.unit,
            reason: top.reason,
            allowance: top.allowance,
            dice: top.dice,
            canPass: true,
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
            options: top.options,
            trigger: top.trigger,
          };
        case 'resolve':
          throw new Error('internal: unresolved attacks on top of the stack');
      }
    }
    if (state.phase === 'combat') {
      const picker = fightPickerFor(state);
      if (picker !== null) return { kind: 'fightPick', player: picker, canPass: false };
    }
    return { kind: 'main', player: state.active, phase: state.phase };
  }

  function unitOptions(state: GameState, unitId: UnitId): UnitOption[] {
    const d = decision(state);
    const unit = state.units[unitId];
    if (!d || !unit || unit.status !== 'battlefield' || unit.owner !== d.player) return [];
    if (d.kind === 'fightPick') {
      return eligibleFighters(scenario, state, d.player).some((u) => u.id === unitId)
        ? [{ t: 'fight' }]
        : [];
    }
    if (d.kind !== 'main') return [];
    switch (d.phase) {
      case 'hero':
        return canRally(scenario, state, unit) ? [{ t: 'command', command: 'rally', cost: 1 }] : [];
      case 'movement': {
        const moves = moveOptions(scenario, state, unit);
        const canRun = moves.some((o) => o.t === 'move' && o.kind === 'run');
        if (canRun && !commandBlocker(state, unit.owner, 'atTheDouble', unit)) {
          return [...moves, { t: 'command', command: 'atTheDouble', cost: 1 }];
        }
        return moves;
      }
      case 'shooting':
        return mayShoot(unit) && weaponTargets(scenario, state, unit, 'shoot').length > 0
          ? [{ t: 'shoot' }]
          : [];
      case 'charge':
        return canCharge(scenario, state, unit) ? [{ t: 'charge' }] : [];
      default:
        return [];
    }
  }

  function targetOptions(state: GameState, unitId: UnitId, mode: AttackMode): WeaponTargets[] {
    const unit = state.units[unitId];
    return unit ? weaponTargets(scenario, state, unit, mode) : [];
  }

  function checkPlacement(state: GameState, placement: Placement): Violation[] {
    const d = decision(state);
    if (!d || d.kind !== 'place') {
      return [{ code: 'BLOCKED', message: 'No unit is being placed right now.' }];
    }
    if (placement.unit !== d.unit) {
      return [{ code: 'WRONG_MODELS', message: 'That is not the unit being placed.' }];
    }
    return checkMovePlacement(scenario, state, unitById(state, d.unit), placement, {
      reason: d.reason,
      allowance: d.allowance,
    });
  }

  // ─── Actions ──────────────────────────────────────────────────────────────────

  function useCommandOn(
    ctx: Ctx,
    command: 'rally' | 'atTheDouble' | 'allOutAttack' | 'allOutDefence',
    unit: UnitState,
  ): void {
    const blocker = commandBlocker(ctx.s, unit.owner, command, unit);
    if (blocker) illegal(blocker);
    payCommand(ctx.s, unit.owner, command, unit);
    ctx.events.push({ t: 'command', player: unit.owner, command, unit: unit.id });
  }

  function declareMove(ctx: Ctx, unitId: UnitId, kind: MoveKind, atTheDouble = false): void {
    const { s } = ctx;
    const option = unitOptions(s, unitId).find((o) => o.t === 'move' && o.kind === kind);
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

  function rally(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit || !canRally(scenario, s, unit)) illegal('That unit cannot rally now.');
    useCommandOn(ctx, 'rally', unit);
    const dice = d6s(ctx, RALLY_ROLLS);
    ctx.events.push({ t: 'roll', player: unit.owner, label: 'Rally', dice });
    const health = profileOf(scenario, unit).health;
    const dead = unit.models.flatMap((m, i) => (m.alive ? [] : [i]));
    let points = rallyPoints(dice);
    const spend = rallySpend(points, health, dead.length, unit.damage);
    let returned = 0;
    for (const i of dead.slice(0, spend.returnModels)) {
      const at = returnPosition(scenario, s, unit, i);
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

  function place(ctx: Ctx, placement: Placement): void {
    const { s } = ctx;
    const frame = s.stack[s.stack.length - 1];
    if (!frame || frame.t !== 'place') illegal('No unit is being placed right now.');
    const violations = checkPlacement(s, placement);
    if (violations.length > 0) illegal(violations[0]!.message, violations);
    const unit = s.units[frame.unit]!;
    const distance = placementDistance(unit, placement);
    for (const m of placement.models) {
      const model = unit.models[m.i]!;
      model.x = m.x;
      model.y = m.y;
      model.rot = m.rot;
    }
    if (frame.reason === 'normal' || frame.reason === 'run' || frame.reason === 'retreat') {
      unit.moved = frame.reason;
    }
    if (frame.reason === 'charge') unit.charged = true;
    s.stack.pop();
    ctx.events.push({ t: 'moved', unit: unit.id, kind: frame.reason, dice: frame.dice, distance });
    if (frame.reason === 'retreat') {
      const roll = ctx.rng.int(1, 3);
      ctx.events.push({
        t: 'roll',
        player: unit.owner,
        label: 'Retreat (D3 mortal damage)',
        dice: [roll],
      });
      inflictMortalDamage(ctx, unit, roll, 'Retreat');
    }
  }

  function skipPlace(ctx: Ctx): void {
    const frame = ctx.s.stack.pop();
    if (frame?.t === 'place' && frame.reason === 'charge') {
      ctx.events.push({ t: 'note', text: `${ctx.s.units[frame.unit]!.name}'s charge fails.` });
    }
  }

  function declareCharge(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    if (!unitOptions(s, unitId).some((o) => o.t === 'charge'))
      illegal('That unit cannot charge now.');
    const unit = s.units[unitId]!;
    unit.chargeDeclared = true;
    const dice: [number, number] = [d6(ctx), d6(ctx)];
    const roll = dice[0] + dice[1];
    const success = unitsOf(s, opponent(unit.owner)).some((e) =>
      unitsWithin(scenario, unit, e, roll + CHARGE_END_RANGE),
    );
    ctx.events.push({ t: 'chargeRoll', unit: unitId, dice, success });
    if (success)
      s.stack.push({ t: 'place', unit: unitId, reason: 'charge', allowance: roll, dice });
  }

  /** Pays for All-out Attack, then offers All-out Defence or resolves the attacks. */
  function startAttacks(
    ctx: Ctx,
    unit: UnitState,
    mode: AttackMode,
    allocations: Allocation[],
    allOutAttack: boolean,
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
    };
    const defender = opponent(unit.owner);
    const options: ReactionOption[] = [];
    for (const id of new Set(allocations.map((a) => a.target))) {
      const target = s.units[id]!;
      if (!commandBlocker(s, defender, 'allOutDefence', target)) {
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

  function answerReaction(ctx: Ctx, action: Action): void {
    const { s } = ctx;
    const reaction = s.stack[s.stack.length - 1];
    if (reaction?.t !== 'reaction') illegal('There is no reaction to answer.');
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
    const pending = s.stack.pop();
    if (pending?.t !== 'resolve') throw new Error('internal: reaction without pending attacks');
    resolveAttacks(ctx, { ...pending, defended });
  }

  function declareShoot(ctx: Ctx, action: Extract<Action, { t: 'shoot' }>): void {
    const { s } = ctx;
    const unit = s.units[action.unit];
    if (!unit || !unitOptions(s, action.unit).some((o) => o.t === 'shoot')) {
      illegal('That unit cannot shoot now.');
    }
    if (action.allocations.length === 0) illegal('Pick a target for at least one weapon.');
    checkAllocations(weaponTargets(scenario, s, unit, 'shoot'), action.allocations);
    unit.shot = true;
    startAttacks(ctx, unit, 'shoot', action.allocations, action.allOutAttack ?? false);
  }

  function declareFight(ctx: Ctx, player: PlayerId, unitId: UnitId): void {
    const { s } = ctx;
    if (!eligibleFighters(scenario, s, player).some((u) => u.id === unitId)) {
      illegal('That unit cannot fight now.');
    }
    s.units[unitId]!.fought = true;
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

  function declareTargets(ctx: Ctx, action: Extract<Action, { t: 'targets' }>): void {
    const { s } = ctx;
    const frame = s.stack[s.stack.length - 1];
    if (frame?.t !== 'targets') illegal('No unit is choosing targets.');
    const unit = s.units[frame.unit]!;
    checkAllocations(weaponTargets(scenario, s, unit, frame.mode), action.allocations);
    s.stack.pop();
    if (action.allocations.length === 0) {
      if (action.allOutAttack) illegal('All-out Attack needs at least one attack.');
      return;
    }
    startAttacks(ctx, unit, frame.mode, action.allocations, action.allOutAttack ?? false);
  }

  /** A fight whose unit has nothing left to attack ends without a `targets` decision. */
  function settle(ctx: Ctx): void {
    const { s } = ctx;
    const top = s.stack[s.stack.length - 1];
    if (
      top?.t === 'targets' &&
      weaponTargets(scenario, s, s.units[top.unit]!, top.mode).length === 0
    ) {
      s.stack.pop();
      ctx.events.push({
        t: 'note',
        text: `${s.units[top.unit]!.name} has no enemy in range to attack.`,
      });
    }
  }

  function apply(state: GameState, action: Action): StepResult {
    const d = decision(state);
    if (!d) illegal('The game has ended.');
    const s = cloneState(state);
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };

    switch (d.kind) {
      case 'priority':
        if (action.t !== 'choose') illegal('Choose to take the first or second turn.');
        choosePriority(ctx, action.value);
        break;
      case 'main':
        if (action.t === 'pass') advancePhase(ctx);
        else if (action.t === 'move')
          declareMove(ctx, action.unit, action.kind, action.atTheDouble);
        else if (action.t === 'command' && d.phase === 'hero' && action.command === 'rally') {
          rally(ctx, action.unit);
        } else if (
          action.t === 'command' &&
          d.phase === 'movement' &&
          action.command === 'atTheDouble'
        ) {
          declareMove(ctx, action.unit, 'run', true);
        } else if (action.t === 'shoot' && d.phase === 'shooting') declareShoot(ctx, action);
        else if (action.t === 'charge' && d.phase === 'charge') declareCharge(ctx, action.unit);
        else illegal(`Action "${action.t}" is not available in the ${d.phase} phase.`);
        break;
      case 'place':
        if (action.t === 'pass') skipPlace(ctx);
        else if (action.t === 'place') place(ctx, action.placement);
        else illegal('Place the unit or leave it where it is.');
        break;
      case 'fightPick':
        if (action.t === 'fight') declareFight(ctx, d.player, action.unit);
        else if (action.t === 'pass' && d.canPass) advancePhase(ctx);
        else illegal('Pick a unit to fight.');
        break;
      case 'targets':
        if (action.t !== 'targets') illegal('Choose targets for the weapons.');
        declareTargets(ctx, action);
        break;
      case 'reaction':
        answerReaction(ctx, action);
        break;
    }
    settle(ctx);
    s.rng = ctx.rng.state;
    return { state: s, events: ctx.events };
  }

  // Set-up uses no dice, so it is computed once per engine and copied for each game.
  let deployed: UnitState[] | null = null;

  function newGame(seed: number): GameState {
    deployed ??= deployArmies(scenario);
    const units = deployed.map((u) => ({ ...u, models: u.models.map((m) => ({ ...m })) }));
    const s: GameState = {
      seed,
      rng: rngFromSeed(seed),
      status: 'playing',
      round: 1,
      turnIndex: 0,
      active: 0,
      firstPlayer: 0,
      phase: 'hero',
      players: [
        { cp: 0, vp: 0, vpByRound: [], commandsUsed: [] },
        { cp: 0, vp: 0, vpByRound: [], commandsUsed: [] },
      ],
      units: Object.fromEntries(units.map((u) => [u.id, u])),
      unitOrder: units.map((u) => u.id),
      objectives: scenario.battlefield.objectives.map((o) => ({ id: o.id, controller: null })),
      stack: [],
      fightPicker: null,
      winner: null,
      seizedBy: null,
    };
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };
    startRound(ctx);
    s.rng = ctx.rng.state;
    return s;
  }

  function defaultAction(state: GameState): Action {
    const d = decision(state);
    if (!d) illegal('The game has ended.');
    switch (d.kind) {
      case 'priority':
        return { t: 'choose', value: 'first' };
      case 'fightPick':
        if (d.canPass) return { t: 'pass' };
        return { t: 'fight', unit: eligibleFighters(scenario, state, d.player)[0]!.id };
      case 'targets':
        return {
          t: 'targets',
          allocations: targetOptions(state, d.unit, d.mode).map((w) => ({
            weaponId: w.weaponId,
            target: w.targets[0]!.unit,
          })),
        };
      default:
        return { t: 'pass' };
    }
  }

  return {
    scenario,
    newGame,
    decision,
    unitOptions,
    targetOptions,
    checkPlacement,
    apply,
    defaultAction,
  };
}
