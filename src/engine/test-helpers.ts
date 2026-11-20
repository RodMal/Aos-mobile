/** Helpers shared by engine, rules and NPC tests: scripted dice and arranged positions. */
import type { Weapon, WeaponAbility } from '../data/profile.js';
import { formPlacement } from './query.js';
import { RngCursor } from './rng.js';
import type { Action, Engine, GameState, Phase, Scenario, StepResult, UnitId } from './types.js';

/** An RNG cursor that returns the given dice (for `int(1, n)`) in order. */
export class ScriptedDice extends RngCursor {
  private readonly queue: number[];
  constructor(dice: number[]) {
    super(0);
    this.queue = [...dice];
  }
  override int(min: number, max: number): number {
    const v = this.queue.shift();
    if (v === undefined) throw new Error('ran out of scripted dice');
    if (v < min || v > max) throw new Error(`scripted die ${v} outside ${min}..${max}`);
    return v;
  }
  get remaining(): number {
    return this.queue.length;
  }
}

/** A weapon with fixed characteristics, for attack tests. */
export function weapon(
  over: Partial<Omit<Weapon, 'abilities'>> & { abilities?: WeaponAbility[] } = {},
): Weapon {
  return {
    id: 'w',
    name: 'Test Weapon',
    kind: 'melee',
    range: 0,
    attacks: { n: 0, sides: 0, plus: 1 },
    hit: 4,
    wound: 4,
    rend: 0,
    damage: { n: 0, sides: 0, plus: 1 },
    abilities: [],
    abilityText: [],
    ...over,
  };
}

/** A JSON copy of the state, safe to edit in a test. */
export function editable(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** Removes every unit not listed (marks it destroyed). Edits `state`. */
export function keepOnly(state: GameState, ids: UnitId[]): void {
  for (const id of state.unitOrder) {
    if (ids.includes(id)) continue;
    const u = state.units[id]!;
    u.status = 'destroyed';
    for (const m of u.models) m.alive = false;
  }
}

/** Sets a unit up in formation around (x, y), front facing `facing` degrees. Edits `state`. */
export function placeUnit(
  scenario: Scenario,
  state: GameState,
  id: UnitId,
  x: number,
  y: number,
  facing = 0,
): void {
  const unit = state.units[id]!;
  for (const m of formPlacement(scenario, unit, { x, y }, facing).models) {
    Object.assign(unit.models[m.i]!, { x: m.x, y: m.y, rot: m.rot });
  }
}

/**
 * Applies `action` from copies of `state` with different RNG states until `accept` likes
 * the result: a way to get a particular dice outcome without scripting the generator.
 */
export function applyUntil(
  engine: Engine,
  state: GameState,
  action: Action,
  accept: (r: StepResult) => boolean,
): StepResult {
  for (let rng = 1; rng < 2000; rng++) {
    const r = engine.apply({ ...state, rng }, action);
    if (accept(r)) return r;
  }
  throw new Error('no RNG state gave the wanted outcome');
}

/**
 * Celestial Conduit and Coatl Familiar are offered when a spell is declared. For a test that
 * wants the casting roll: the state and action to roll it from (the reactions skipped with a
 * pass when they are offered, else the declaration itself).
 */
export function skipDeclareReactions(
  engine: Engine,
  state: GameState,
  action: Action,
): { state: GameState; action: Action } {
  const d = engine.decision(engine.apply(state, action).state);
  if (d?.kind !== 'reaction' || !d.trigger.startsWith('declare:')) return { state, action };
  return { state: engine.apply(state, action).state, action: { t: 'pass' } };
}

/**
 * The state as the engine reaches the combat phase: the charge phase of `state` ended with
 * passes, so the start-of-combat window (Core 13.1) is open when anyone has an ability for it.
 */
export function enterCombat(engine: Engine, state: GameState): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  s.phase = 'charge';
  s.stack = [];
  return passTo(engine, s, 'combat');
}

/** Passes every start-of-combat window still open, to the first fighter pick. */
export function skipWindows(engine: Engine, state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 10; i++) {
    const d = engine.decision(s);
    if (d?.kind !== 'reaction' || d.trigger !== 'start:combat') return s;
    s = engine.apply(s, { t: 'pass' }).state;
  }
  throw new Error('start-of-combat windows did not end');
}

/** Passes main decisions until the given phase of the current turn. */
export function passTo(engine: Engine, state: GameState, phase: Phase): GameState {
  let s = state;
  for (let i = 0; i < 20 && s.phase !== phase; i++) s = engine.apply(s, { t: 'pass' }).state;
  if (s.phase !== phase) throw new Error(`did not reach ${phase}`);
  return s;
}

/**
 * A quick-start game advanced past the pre-battle choices (the Burning for Vengeance fugitive,
 * the first-turn choice and optional start-of-turn prompts) to the first `main` decision, each
 * answered with `engine.defaultAction`. No dice are rolled on the way.
 */
export function startGame(engine: Engine, seed: number): GameState {
  let s = engine.newGame(seed);
  for (let i = 0; i < 10; i++) {
    const d = engine.decision(s);
    if (!d || d.kind === 'main') break;
    s = engine.apply(s, engine.defaultAction(s)).state;
  }
  return s;
}

/**
 * Answers any Glamourweave re-roll question the result stops at by re-rolling (the engine's
 * default answer), so a test that does not care about the choice sees the attacks resolved.
 */
export function takeRerolls(engine: Engine, result: StepResult): StepResult {
  let r = result;
  for (let i = 0; i < 50; i++) {
    const d = engine.decision(r.state);
    if (d?.kind !== 'reaction' || !d.options.some((o) => o.ability === 'glamourweave')) break;
    const next = engine.apply(r.state, engine.defaultAction(r.state));
    r = { ...next, events: [...r.events, ...next.events] };
  }
  return r;
}
