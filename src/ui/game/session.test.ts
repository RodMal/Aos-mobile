import { describe, expect, it } from 'vitest';
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

function toMovement() {
  let s = newSession(engine, 5, 0);
  s = applyToSession(engine, s, { t: 'pass' }).session;
  return s;
}

describe('session', () => {
  it('applies actions, records the actor and the events', () => {
    const s = toMovement();
    expect(s.state.phase).toBe('movement');
    expect(s.history).toHaveLength(1);
    expect(s.history[0]!.actor).toBe(0);
    expect(s.history[0]!.events.some((e) => e.t === 'phaseStart')).toBe(true);
  });

  it('throws IllegalActionError for illegal actions', () => {
    const s = newSession(engine, 5, 0);
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

  it('does not undo the opponent’s actions', () => {
    let s = newSession(engine, 5, 1);
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
    expect(record.actions).toHaveLength(3);
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
