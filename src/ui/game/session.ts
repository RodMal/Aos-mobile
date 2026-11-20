/**
 * A game in progress as the UI holds it: the state, every action applied with the state
 * before it (for undo) and the events it produced (for the log). Pure; the Zustand store in
 * store.ts wraps it.
 */
import { LEGACY_RULES_VERSION, RULES_VERSION } from './rulesVersion.js';
export { LEGACY_RULES_VERSION, RULES_VERSION };
import { z } from 'zod';
import {
  IllegalActionError,
  type Action,
  type Engine,
  type GameEvent,
  type GameState,
  type PlayerId,
} from '../../engine/index.js';

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
  /** The game started with interactive deployment (`newGame(seed, { deploy: true })`). */
  deploy?: true;
  /** Events from setting the game up (round 1 start). */
  startEvents: GameEvent[];
  state: GameState;
  history: HistoryEntry[];
}

/** What is saved: enough to rebuild the game by replaying it. */
export interface GameRecord {
  v: 1;
  /** The rules version the game was played under; see `RULES_VERSION`. */
  rules: number;
  seed: number;
  humanPlayer: PlayerId;
  /** Started with interactive deployment; absent for a quick-start game. */
  deploy?: true;
  actions: Action[];
}

/** True when a saved game was played under older rules than the engine now has. */
export function isOutdated(record: GameRecord): boolean {
  return record.rules < RULES_VERSION;
}

const RecordSchema = z.object({
  v: z.literal(1),
  rules: z.number().int().min(1).default(LEGACY_RULES_VERSION),
  seed: z.number().int(),
  humanPlayer: z.union([z.literal(0), z.literal(1)]),
  deploy: z.literal(true).optional(),
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
    ...(options?.deploy ? { deploy: true as const } : {}),
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
  // A Glamourweave question rewinds the dice to replay them, so the failed die would be seen
  // and could then be undone: no undo while attacks wait on one, nor back to such a moment.
  const paused = (st: GameState) => st.stack.some((f) => f.t === 'resolve' && f.at !== undefined);
  if (paused(session.state) || paused(h[k]!.before)) return -1;
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
    rules: RULES_VERSION,
    seed: session.seed,
    humanPlayer: session.humanPlayer,
    ...(session.deploy ? { deploy: true as const } : {}),
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

/**
 * The answer a game saved before a question existed gets, when the game now waits on one and the
 * recorded action is not a legal answer to it: a pass to an Asterism, `none` to Vengeance of
 * Azyr (which does not accept a pass, so a recorded pass of the old game is never taken for it),
 * `use` to an answered prayer (a game saved before the choice to bank it).
 * `engine.apply` is pure, so trying is safe.
 */
function missingAnswer(engine: Engine, session: Session, action: Action): Action | null {
  const kind = engine.decision(session.state)?.kind;
  if (kind !== 'asterism' && kind !== 'vengeance' && kind !== 'prayer') return null;
  try {
    engine.apply(session.state, action);
    return null;
  } catch (e) {
    if (e instanceof IllegalActionError) {
      if (kind === 'asterism') return { t: 'pass' };
      // A chanting roll that answered the prayer was always used at once.
      return { t: 'choose', value: kind === 'prayer' ? 'use' : 'none' };
    }
    throw e;
  }
}

/** Rebuilds a game by replaying its actions. Throws if an action is no longer legal. */
export function replay(engine: Engine, record: GameRecord): Session {
  let session = newSession(
    engine,
    record.seed,
    record.humanPlayer,
    record.deploy ? { deploy: true } : undefined,
  );
  for (const action of record.actions) {
    // A game saved before Seraphon Asterisms existed has no answer to The Great Plan or Further
    // the Great Plan: it replays as a pass (nothing prophesied), as it was played.
    // Likewise Vengeance of Azyr, answered as none.
    const missing = missingAnswer(engine, session, action);
    if (missing) session = applyToSession(engine, session, missing).session;
    session = applyToSession(engine, session, action).session;
  }
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
