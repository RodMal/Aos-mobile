/**
 * A game in progress as the UI holds it: the state, every action applied with the state
 * before it (for undo) and the events it produced (for the log). Pure; the Zustand store in
 * store.ts wraps it.
 */
import { z } from 'zod';
import type { Action, Engine, GameEvent, GameState, PlayerId } from '../../engine/index.js';

export interface HistoryEntry {
  action: Action;
  /** The player who answered the decision. */
  actor: PlayerId;
  before: GameState;
  events: GameEvent[];
}

export interface Session {
  seed: number;
  humanPlayer: PlayerId;
  /** Events from setting the game up (round 1 start). */
  startEvents: GameEvent[];
  state: GameState;
  history: HistoryEntry[];
}

/** What is saved: enough to rebuild the game by replaying it. */
export interface GameRecord {
  v: 1;
  seed: number;
  humanPlayer: PlayerId;
  actions: Action[];
}

const RecordSchema = z.object({
  v: z.literal(1),
  seed: z.number().int(),
  humanPlayer: z.union([z.literal(0), z.literal(1)]),
  actions: z.array(z.looseObject({ t: z.string() })),
});

export function newSession(
  engine: Engine,
  seed: number,
  humanPlayer: PlayerId,
  options?: { deploy?: boolean },
): Session {
  const state = engine.newGame(seed, options);
  return {
    seed,
    humanPlayer,
    startEvents: [
      { t: 'roundStart', round: 1 },
      { t: 'turnStart', player: state.active, round: 1 },
      { t: 'phaseStart', phase: state.phase, player: state.active },
    ],
    state,
    history: [],
  };
}

/** Applies an action. Throws the engine's `IllegalActionError` when it is not legal. */
export function applyToSession(
  engine: Engine,
  session: Session,
  action: Action,
): { session: Session; events: GameEvent[] } {
  const d = engine.decision(session.state);
  const actor = d?.player ?? session.state.active;
  const { state, events } = engine.apply(session.state, action);
  return {
    session: {
      ...session,
      state,
      history: [...session.history, { action, actor, before: session.state, events }],
    },
    events,
  };
}

/**
 * Undo is allowed for the last action when the human took it and it rolled no dice
 * (the RNG state is unchanged), so undoing can never re-roll anything.
 */
/**
 * The history index to undo back to: the human's last action, when no dice were rolled since,
 * skipping the opponent's declined reactions that came after it (a Redeploy the computer passed
 * on, say), so they do not block undoing a move. -1 when nothing can be undone.
 */
function undoIndex(session: Session): number {
  const h = session.history;
  let k = h.length - 1;
  while (k >= 0) {
    const e = h[k]!;
    if (e.actor === session.humanPlayer) break;
    const declinedReaction = e.action.t === 'pass' && e.before.stack.at(-1)?.t === 'reaction';
    if (!declinedReaction) return -1;
    k--;
  }
  if (k < 0) return -1;
  return h[k]!.before.rng === session.state.rng ? k : -1;
}

export function canUndo(session: Session): boolean {
  return undoIndex(session) >= 0;
}

export function undo(session: Session): Session {
  const k = undoIndex(session);
  if (k < 0) return session;
  return { ...session, state: session.history[k]!.before, history: session.history.slice(0, k) };
}

export function toRecord(session: Session): GameRecord {
  return {
    v: 1,
    seed: session.seed,
    humanPlayer: session.humanPlayer,
    actions: session.history.map((h) => h.action),
  };
}

/** Parses a saved record; null when it is missing or malformed. */
export function parseRecord(json: string | null): GameRecord | null {
  if (!json) return null;
  try {
    const parsed = RecordSchema.safeParse(JSON.parse(json));
    return parsed.success ? (parsed.data as unknown as GameRecord) : null;
  } catch {
    return null;
  }
}

/** Rebuilds a game by replaying its actions. Throws if an action is no longer legal. */
export function replay(engine: Engine, record: GameRecord): Session {
  let session = newSession(engine, record.seed, record.humanPlayer);
  for (const action of record.actions) session = applyToSession(engine, session, action).session;
  return session;
}

export interface UrlOptions {
  seed: number | null;
  side: PlayerId | null;
  /** No NPC delays or animations. */
  fast: boolean;
  /** Ignore a saved game. */
  fresh: boolean;
  /** Interactive alternating deployment. */
  deploy?: boolean;
}

export function parseUrlOptions(search: string): UrlOptions {
  const q = new URLSearchParams(search);
  const seedRaw = q.get('seed');
  const seed = seedRaw !== null && /^-?\d+$/.test(seedRaw) ? Number(seedRaw) : null;
  const sideRaw = q.get('side');
  const side = sideRaw === '0' ? 0 : sideRaw === '1' ? 1 : null;
  const deploy = q.get('deploy') === '1' || q.get('deploy') === 'true' ? true : undefined;
  return {
    seed,
    side,
    fast: q.get('fast') === '1',
    fresh: q.get('new') === '1',
    ...(deploy !== undefined ? { deploy } : {}),
  };
}

/**
 * Which saved game to resume, if any: none when the URL asks for a new game, or names a
 * seed or side the saved game does not have.
 */
export function shouldResume(record: GameRecord | null, opts: UrlOptions): record is GameRecord {
  if (!record || opts.fresh) return false;
  if (opts.seed !== null && opts.seed !== record.seed) return false;
  if (opts.side !== null && opts.side !== record.humanPlayer) return false;
  return true;
}
