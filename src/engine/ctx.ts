/** The mutable working context of one `apply` call, and small helpers around it. */
import type { Dice } from '../data/profile.js';
import type { RngCursor } from './rng.js';
import { IllegalActionError, type GameEvent, type GameState, type Scenario } from './types.js';
import type { Violation } from './types.js';

export interface Ctx {
  scenario: Scenario;
  /** The cloned state; edit freely. */
  s: GameState;
  events: GameEvent[];
  rng: RngCursor;
}

export function d6(ctx: Ctx): number {
  return ctx.rng.int(1, 6);
}

export function d6s(ctx: Ctx, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(ctx.rng.int(1, 6));
  return out;
}

/** Rolls a dice expression such as D3+3. */
export function rollDice(rng: RngCursor, d: Dice): number {
  let total = d.plus;
  for (let i = 0; i < d.n; i++) total += rng.int(1, d.sides);
  return total;
}

export function illegal(message: string, violations: Violation[] = []): never {
  throw new IllegalActionError(message, violations);
}
