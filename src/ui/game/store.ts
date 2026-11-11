/** The game store: the session, dispatch through the engine, undo, save and resume. */
import { create } from 'zustand';
import {
  IllegalActionError,
  type Action,
  type GameEvent,
  type PlayerId,
} from '../../engine/index.js';
import { engine, logContext } from './engine.js';
import { eventLine, toastLine, type LogLine } from './eventText.js';
import {
  applyToSession,
  canUndo,
  newSession,
  parseRecord,
  replay,
  shouldResume,
  toRecord,
  undo as undoSession,
  type GameRecord,
  type Session,
  type UrlOptions,
} from './session.js';

export const SAVE_KEY = 'aos-mobile:game';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export interface LogEntry extends LogLine {
  id: number;
  round: number;
}

interface GameStore {
  session: Session;
  fast: boolean;
  toast: Toast | null;
  /** Bumped on every new game, so views can reset. */
  gameId: number;
  /** Units the last applied action was about, for the camera. */
  lastFocus: { unit: string; nonce: number } | null;
  dispatch(action: Action): boolean;
  undo(): void;
  newGame(seed: number, humanPlayer: PlayerId, options?: { deploy?: boolean }): void;
  showToast(text: string, tone?: Toast['tone']): void;
  clearToast(): void;
}

let toastId = 0;

function save(session: Session): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(toRecord(session)));
  } catch {
    // Storage can be full or disabled; the game goes on unsaved.
  }
}

export function loadSaved(): GameRecord | null {
  try {
    return parseRecord(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/** The session to start with, from the URL and any saved game. */
export function initialSession(opts: UrlOptions): Session {
  const record = loadSaved();
  if (shouldResume(record, opts)) {
    try {
      return replay(engine, record);
    } catch {
      // The saved actions no longer replay (the engine changed): start afresh.
    }
  }
  const session = newSession(
    engine,
    opts.seed ?? randomSeed(),
    opts.side ?? 0,
    opts.deploy ? { deploy: true } : undefined,
  );
  save(session);
  return session;
}

function focusUnit(events: GameEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (
      e.t === 'moved' ||
      e.t === 'chargeRoll' ||
      e.t === 'cast' ||
      e.t === 'chant' ||
      e.t === 'banish'
    )
      return e.unit;
    if (e.t === 'attacks') return e.target;
  }
  return null;
}

export function createGameStore(initial: Session, fast: boolean) {
  return create<GameStore>((set, get) => ({
    session: initial,
    fast,
    toast: null,
    gameId: 0,
    lastFocus: null,
    dispatch(action) {
      const { session } = get();
      try {
        const res = applyToSession(engine, session, action);
        save(res.session);
        const ctx = logContext(res.session.state.units);
        const lines = res.events.flatMap((e) => eventLine(e, ctx) ?? []);
        const line = toastLine(lines);
        const unit = focusUnit(res.events);
        set({
          session: res.session,
          toast: line ? { id: ++toastId, text: line.text, tone: 'info' } : get().toast,
          lastFocus: unit ? { unit, nonce: ++toastId } : get().lastFocus,
        });
        return true;
      } catch (err) {
        const text =
          err instanceof IllegalActionError
            ? err.message
            : `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
        set({ toast: { id: ++toastId, text, tone: 'error' } });
        return false;
      }
    },
    undo() {
      const { session } = get();
      if (!canUndo(session)) return;
      const next = undoSession(session);
      save(next);
      set({ session: next, toast: { id: ++toastId, text: 'Undone', tone: 'info' } });
    },
    newGame(seed, humanPlayer, options) {
      const session = newSession(engine, seed, humanPlayer, options);
      save(session);
      set((s) => ({ session, toast: null, gameId: s.gameId + 1, lastFocus: null }));
    },
    showToast(text, tone = 'info') {
      set({ toast: { id: ++toastId, text, tone } });
    },
    clearToast() {
      set({ toast: null });
    },
  }));
}

export type GameStoreHook = ReturnType<typeof createGameStore>;

const logCache = new WeakMap<Session['history'], LogEntry[]>();

/** Every log line of the session, oldest first. */
export function buildLog(session: Session): LogEntry[] {
  const cached = logCache.get(session.history);
  if (cached) return cached;
  const out: LogEntry[] = [];
  let id = 0;
  let round = 1;
  const push = (events: GameEvent[], units: Session['state']['units']) => {
    const ctx = logContext(units);
    for (const e of events) {
      if (e.t === 'roundStart') round = e.round;
      const line = eventLine(e, ctx);
      if (line) out.push({ ...line, id: id++, round });
    }
  };
  push(session.startEvents, session.state.units);
  for (const h of session.history) push(h.events, h.before.units);
  logCache.set(session.history, out);
  return out;
}

export { canUndo };
