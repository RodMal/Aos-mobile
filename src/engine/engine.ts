import { RngCursor, rngFromSeed } from './rng.js';
import { checkMovePlacement, placementDistance } from './movement.js';
import { inCombat, opponent, profileOf, unitById } from './query.js';
import { deployArmies } from './setup.js';
import {
  IllegalActionError,
  PHASES,
  type Action,
  type AttackMode,
  type Decision,
  type Engine,
  type GameEvent,
  type GameState,
  type MoveKind,
  type Placement,
  type PlayerId,
  type Scenario,
  type StepResult,
  type UnitId,
  type UnitOption,
  type UnitState,
  type Violation,
  type WeaponTargets,
} from './types.js';

/** Command points each player receives at the start of a battle round. */
export const CP_PER_ROUND = 4;

/** A deep copy of the state. `apply` clones once and then edits the copy freely. */
export function cloneState(state: GameState): GameState {
  const units: Record<UnitId, UnitState> = {};
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    units[id] = { ...u, models: u.models.map((m) => ({ ...m })) };
  }
  return {
    ...state,
    players: [
      { ...state.players[0], vpByRound: [...state.players[0].vpByRound] },
      { ...state.players[1], vpByRound: [...state.players[1].vpByRound] },
    ],
    units,
    unitOrder: [...state.unitOrder],
    objectives: state.objectives.map((o) => ({ ...o })),
    stack: state.stack.map((f) => ({ ...f })),
  };
}

/** Mutable working context for one `apply` call. */
interface Ctx {
  scenario: Scenario;
  s: GameState;
  events: GameEvent[];
  rng: RngCursor;
}

function d6(ctx: Ctx): number {
  return ctx.rng.int(1, 6);
}

function illegal(message: string, violations: Violation[] = []): never {
  throw new IllegalActionError(message, violations);
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
  }
  s.phase = 'hero';
  ctx.events.push({ t: 'turnStart', player: s.active, round: s.round });
  ctx.events.push({ t: 'phaseStart', phase: s.phase, player: s.active });
}

function startRound(ctx: Ctx): void {
  const { s } = ctx;
  ctx.events.push({ t: 'roundStart', round: s.round });
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].cp = CP_PER_ROUND;
    s.players[p].vpByRound.push(0);
    ctx.events.push({ t: 'commandPoints', player: p, cp: CP_PER_ROUND });
  }
  s.turnIndex = 0;
  s.active = s.firstPlayer;
  startTurn(ctx);
}

function endGame(ctx: Ctx): void {
  const { s } = ctx;
  const [a, b] = [s.players[0].vp, s.players[1].vp];
  s.status = 'ended';
  s.winner = a === b ? 'draw' : a > b ? 0 : 1;
  ctx.events.push({ t: 'gameEnd', winner: s.winner, vp: [a, b] });
}

function advancePhase(ctx: Ctx): void {
  const { s, scenario } = ctx;
  const next = PHASES[PHASES.indexOf(s.phase) + 1];
  if (next) {
    s.phase = next;
    ctx.events.push({ t: 'phaseStart', phase: next, player: s.active });
    return;
  }
  // End of the turn.
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

// ─── Options ────────────────────────────────────────────────────────────────────

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

// ─── Engine ─────────────────────────────────────────────────────────────────────

export function createEngine(scenario: Scenario): Engine {
  function decision(state: GameState): Decision | null {
    if (state.status === 'ended') return null;
    const top = state.stack[state.stack.length - 1];
    if (top) {
      switch (top.t) {
        case 'priority':
          return { kind: 'priority', player: top.winner, rolls: top.rolls };
        case 'place': {
          const unit = unitById(state, top.unit);
          return {
            kind: 'place',
            player: unit.owner,
            unit: top.unit,
            reason: top.reason,
            allowance: top.allowance,
            dice: top.dice,
            canPass: true,
          };
        }
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
      }
    }
    return { kind: 'main', player: state.active, phase: state.phase };
  }

  function unitOptions(state: GameState, unitId: UnitId): UnitOption[] {
    const d = decision(state);
    const unit = state.units[unitId];
    if (!d || !unit || unit.status !== 'battlefield' || unit.owner !== d.player) return [];
    if (d.kind === 'main' && d.phase === 'movement') return moveOptions(scenario, state, unit);
    return [];
  }

  function targetOptions(_state: GameState, _unit: UnitId, _mode: AttackMode): WeaponTargets[] {
    return [];
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

  function declareMove(ctx: Ctx, unitId: UnitId, kind: MoveKind): void {
    const { s } = ctx;
    const option = unitOptions(s, unitId).find((o) => o.t === 'move' && o.kind === kind);
    if (!option || option.t !== 'move') illegal(`That unit cannot ${kind} now.`);
    const dice: number[] = [];
    let allowance = option.allowance;
    if (kind === 'run') {
      const roll = d6(ctx);
      dice.push(roll);
      allowance += roll;
      // A run is committed once the die is rolled, whether or not the unit then moves.
      s.units[unitId]!.moved = 'run';
      ctx.events.push({ t: 'roll', player: s.active, label: 'Run', dice: [roll] });
    }
    s.stack.push({ t: 'place', unit: unitId, reason: kind, allowance, dice });
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
    s.stack.pop();
    ctx.events.push({ t: 'moved', unit: unit.id, kind: frame.reason, dice: frame.dice, distance });
  }

  function apply(state: GameState, action: Action): StepResult {
    const d = decision(state);
    if (!d) illegal('The game has ended.');
    const s = cloneState(state);
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };

    switch (d.kind) {
      case 'main':
        if (action.t === 'pass') advancePhase(ctx);
        else if (action.t === 'move') declareMove(ctx, action.unit, action.kind);
        else illegal(`Action "${action.t}" is not available in the ${d.phase} phase.`);
        break;
      case 'place':
        if (action.t === 'pass') s.stack.pop();
        else if (action.t === 'place') place(ctx, action.placement);
        else illegal('Place the unit or leave it where it is.');
        break;
      default:
        illegal(`Decision "${d.kind}" is not supported yet.`);
    }
    s.rng = ctx.rng.state;
    return { state: s, events: ctx.events };
  }

  function newGame(seed: number): GameState {
    const units = deployArmies(scenario);
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
        { cp: 0, vp: 0, vpByRound: [] },
        { cp: 0, vp: 0, vpByRound: [] },
      ],
      units: Object.fromEntries(units.map((u) => [u.id, u])),
      unitOrder: units.map((u) => u.id),
      objectives: scenario.battlefield.objectives.map((o) => ({ id: o.id, controller: null })),
      stack: [],
      fightPicker: null,
      winner: null,
    };
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };
    startRound(ctx);
    s.rng = ctx.rng.state;
    return s;
  }

  function defaultAction(state: GameState): Action {
    if (!decision(state)) illegal('The game has ended.');
    return { t: 'pass' };
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
