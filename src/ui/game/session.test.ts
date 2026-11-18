import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  shiftPlacement,
  currentPlacement,
} from '../../engine/index.js';
import {
  applyToSession,
  canUndo,
  newSession,
  parseRecord,
  parseUrlOptions,
  replay,
  shouldResume,
  toRecord,
  undo,
} from './session.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

/** A new session with the pre-battle choices (the fugitive) answered by default. */
function started(human: 0 | 1) {
  let s = newSession(engine, 5, human);
  while (engine.decision(s.state)?.kind !== 'main') {
    s = applyToSession(engine, s, engine.defaultAction(s.state)).session;
  }
  return s;
}

const PRE_BATTLE = started(0).history.length;

function toMovement() {
  let s = started(0);
  // End the hero phase; the opponent may be offered a reaction first (declined).
  while (s.state.phase === 'hero' || engine.decision(s.state)?.kind !== 'main') {
    s = applyToSession(engine, s, { t: 'pass' }).session;
  }
  return s;
}

const TO_MOVEMENT = toMovement().history.length - PRE_BATTLE;

describe('session', () => {
  it('applies actions, records the actor and the events', () => {
    const s = toMovement();
    expect(s.state.phase).toBe('movement');
    expect(s.history).toHaveLength(PRE_BATTLE + TO_MOVEMENT);
    expect(s.history[PRE_BATTLE]!.actor).toBe(0);
    expect(s.history.at(-1)!.events.some((e) => e.t === 'phaseStart')).toBe(true);
  });

  it('throws IllegalActionError for illegal actions', () => {
    const s = started(0);
    expect(() => applyToSession(engine, s, { t: 'move', unit: '0:6', kind: 'normal' })).toThrow(
      IllegalActionError,
    );
  });

  it('undoes actions that rolled no dice, but not past a dice roll', () => {
    let s = toMovement();
    s = applyToSession(engine, s, { t: 'move', unit: '0:6', kind: 'normal' }).session;
    expect(canUndo(s)).toBe(true);
    s = undo(s);
    expect(s.state.stack).toHaveLength(0);
    s = applyToSession(engine, s, { t: 'move', unit: '0:6', kind: 'run' }).session;
    expect(canUndo(s)).toBe(false);
    const placement = shiftPlacement(currentPlacement(s.state.units['0:6']!), 1, 0);
    s = applyToSession(engine, s, { t: 'place', placement }).session;
    expect(canUndo(s)).toBe(true);
    s = undo(s);
    expect(s.state.stack[0]?.t).toBe('place');
    expect(canUndo(s)).toBe(false);
  });

  it('undoes a move past the opponent’s declined reaction to it', () => {
    let s = toMovement();
    const before = s.state;
    s = applyToSession(engine, s, { t: 'move', unit: '0:6', kind: 'normal' }).session;
    const placement = shiftPlacement(currentPlacement(s.state.units['0:6']!), 1, 0);
    s = applyToSession(engine, s, { t: 'place', placement }).session;
    const d = engine.decision(s.state);
    expect(d?.kind).toBe('main'); // Redeploy is offered only when the phase is passed
    expect(canUndo(s)).toBe(true);
    s = undo(s);
    expect(s.state.stack.at(-1)?.t).toBe('place');
    s = undo(s);
    expect(s.state).toEqual(before);
  });

  it('does not undo the opponent’s actions', () => {
    let s = started(1);
    s = applyToSession(engine, s, { t: 'pass' }).session;
    expect(canUndo(s)).toBe(false);
  });

  it('saves and replays to the same state', () => {
    let s = toMovement();
    s = applyToSession(engine, s, { t: 'move', unit: '0:6', kind: 'run' }).session;
    const placement = shiftPlacement(currentPlacement(s.state.units['0:6']!), 2, 0);
    s = applyToSession(engine, s, { t: 'place', placement }).session;
    const json = JSON.stringify(toRecord(s));
    const record = parseRecord(json)!;
    expect(record.actions).toHaveLength(PRE_BATTLE + TO_MOVEMENT + 2);
    expect(replay(engine, record).state).toEqual(s.state);
  });

  it('replays a game saved before Seraphon Asterisms existed (no answer to The Great Plan)', () => {
    const s = toMovement();
    const asks = s.history.filter((h) => engine.decision(h.before)?.kind === 'asterism');
    expect(asks.length).toBeGreaterThan(0);
    const old = toRecord(s);
    old.actions = s.history.filter((h) => !asks.includes(h)).map((h) => h.action);
    expect(old.actions.length).toBe(s.history.length - asks.length);
    expect(replay(engine, old).state).toEqual(s.state);
  });

  it('replays a game saved before Vengeance of Azyr existed (no answer to it)', () => {
    let old: ReturnType<typeof toRecord> | null = null;
    let played: ReturnType<typeof newSession> | null = null;
    for (let seed = 1; seed < 40 && !old; seed++) {
      let s = newSession(engine, seed, 1);
      let asked = 0;
      for (let i = 0; i < 3000 && engine.decision(s.state); i++) {
        const d = engine.decision(s.state)!;
        // The NPC plays both sides; Vengeance of Azyr is declined, as the old game never used it.
        const action =
          d.kind === 'vengeance' ? engine.defaultAction(s.state) : chooseAction(engine, s.state);
        if (d.kind === 'vengeance') asked++;
        s = applyToSession(engine, s, action).session;
      }
      if (asked === 0) continue;
      const answers = s.history.filter((h) => engine.decision(h.before)?.kind === 'vengeance');
      const record = toRecord(s);
      record.actions = s.history.filter((h) => !answers.includes(h)).map((h) => h.action);
      old = record;
      played = s;
    }
    expect(old).not.toBeNull();
    // A question asked after the last recorded action (the game's final turn end) is still open.
    let replayed = replay(engine, old!);
    while (engine.decision(replayed.state)?.kind === 'vengeance') {
      replayed = applyToSession(engine, replayed, { t: 'choose', value: 'none' }).session;
    }
    expect(replayed.state).toEqual(played!.state);
  });

  it('saves and replays a game where Further the Great Plan was answered with a key and a new Asterism', () => {
    let s = newSession(engine, 5, 1);
    let further = 0;
    for (let i = 0; i < 600 && further < 2; i++) {
      const d = engine.decision(s.state);
      if (!d) break;
      let action = engine.defaultAction(s.state);
      if (d.kind === 'asterism' && d.stage === 'great') {
        action = { t: 'choose', value: d.options[3]!.id };
      } else if (d.kind === 'asterism') {
        const key = d.keys.find((k) => k.met)!;
        action = { t: 'choose', value: `${key.id},${d.options[0]!.id}` };
        further++;
      }
      s = applyToSession(engine, s, action).session;
    }
    expect(further).toBeGreaterThan(0);
    const record = parseRecord(JSON.stringify(toRecord(s)))!;
    expect(replay(engine, record).state).toEqual(s.state);
  });

  it('rejects malformed records', () => {
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord('{nope')).toBeNull();
    expect(parseRecord('{"v":2}')).toBeNull();
  });
});

describe('url options', () => {
  it('parses seed, side, fast and new', () => {
    expect(parseUrlOptions('?seed=42&side=1&fast=1')).toEqual({
      seed: 42,
      side: 1,
      fast: true,
      fresh: false,
    });
    expect(parseUrlOptions('?new=1&seed=x')).toEqual({
      seed: null,
      side: null,
      fast: false,
      fresh: true,
    });
  });

  it('resumes only a matching saved game', () => {
    const record = { v: 1 as const, seed: 4, humanPlayer: 0 as const, actions: [] };
    const base = parseUrlOptions('');
    expect(shouldResume(record, base)).toBe(true);
    expect(shouldResume(record, { ...base, fresh: true })).toBe(false);
    expect(shouldResume(record, { ...base, seed: 5 })).toBe(false);
    expect(shouldResume(record, { ...base, seed: 4, side: 0 })).toBe(true);
    expect(shouldResume(null, base)).toBe(false);
  });
});
