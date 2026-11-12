import { describe, expect, it } from 'vitest';
import { chargePlacement, pileInPlacement } from '../ai/placement.js';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import {
  createEngine,
  createScenario,
  currentPlacement,
  IllegalActionError,
  inCombat,
  shiftPlacement,
  type GameState,
} from './index.js';
import { applyUntil, editable, keepOnly, passTo, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);
const DRYADS = '0:6';
const BELTHANOS = '0:1';
const SAURUS = '1:1';
const SKINKS = '1:7';

/** Dryads at (20, 22) and Saurus Guard centred at x = saurusX (23.5 is about 1" apart, 30 about 7.4"). */
function arena(phase: GameState['phase'], saurusX: number): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, [DRYADS, BELTHANOS, SAURUS, SKINKS]);
  placeUnit(scenario, s, DRYADS, 20, 22, 90);
  placeUnit(scenario, s, SAURUS, saurusX, 22, 270);
  placeUnit(scenario, s, BELTHANOS, 8, 8);
  placeUnit(scenario, s, SKINKS, 52, 40);
  s.players[0].cp = 0; // no All-out Defence prompts unless a test wants them
  s.players[1].cp = 0;
  // No Fight Through the Pain prompts (src/engine/fury-pain.test.ts covers them).
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return passTo(engine, s, phase);
}

describe('charge', () => {
  it('is offered to a unit not in combat with an enemy within 12.5"', () => {
    const s = arena('charge', 30);
    expect(engine.unitOptions(s, DRYADS)).toEqual([{ t: 'charge' }]);
    expect(engine.unitOptions(s, BELTHANOS)).toEqual([]); // nothing within reach
  });

  it('a unit that ran or retreated cannot charge', () => {
    const s = editable(arena('charge', 30));
    s.units[DRYADS]!.moved = 'run';
    expect(engine.unitOptions(s, DRYADS)).toEqual([]);
  });

  it('rolls 2D6; a roll that reaches an enemy creates a place decision with that allowance', () => {
    const s = arena('charge', 30);
    const r = applyUntil(engine, s, { t: 'charge', unit: DRYADS }, (x) =>
      x.events.some((e) => e.t === 'chargeRoll' && e.success),
    );
    const roll = r.events.find((e) => e.t === 'chargeRoll');
    if (roll?.t !== 'chargeRoll') throw new Error('no charge roll');
    const d = engine.decision(r.state);
    expect(d).toMatchObject({
      kind: 'place',
      reason: 'charge',
      allowance: roll.dice[0] + roll.dice[1],
    });
    expect(r.state.units[DRYADS]!.chargeDeclared).toBe(true);
    expect(engine.unitOptions(engine.apply(r.state, { t: 'pass' }).state, DRYADS)).toEqual([]);
  });

  it('a roll too short to reach any enemy fails without a decision', () => {
    const s = arena('charge', 31);
    const r = applyUntil(engine, s, { t: 'charge', unit: DRYADS }, (x) =>
      x.events.some((e) => e.t === 'chargeRoll' && e.dice[0] + e.dice[1] <= 3),
    );
    expect(r.events).toContainEqual(expect.objectContaining({ t: 'chargeRoll', success: false }));
    expect(engine.decision(r.state)).toMatchObject({ kind: 'main', phase: 'charge' });
  });

  it('must end within 1/2" of an enemy, may enter combat range, and sets "charged"', () => {
    const s = arena('charge', 30);
    const r = applyUntil(engine, s, { t: 'charge', unit: DRYADS }, (x) =>
      x.events.some((e) => e.t === 'chargeRoll' && e.dice[0] + e.dice[1] >= 8),
    );
    const short = shiftPlacement(currentPlacement(r.state.units[DRYADS]!), 1, 0);
    expect(engine.checkPlacement(r.state, short).map((v) => v.code)).toContain(
      'NOT_IN_CHARGE_RANGE',
    );
    const placement = chargePlacement(engine, r.state, DRYADS)!;
    expect(placement).not.toBeNull();
    expect(engine.checkPlacement(r.state, placement)).toEqual([]);
    const after = engine.apply(r.state, { t: 'place', placement }).state;
    expect(after.units[DRYADS]!.charged).toBe(true);
    expect(inCombat(scenario, after, after.units[DRYADS]!)).toBe(true);
  });

  it('passing on the placement fails the charge', () => {
    const s = arena('charge', 30);
    const r = applyUntil(engine, s, { t: 'charge', unit: DRYADS }, (x) =>
      x.events.some((e) => e.t === 'chargeRoll' && e.success),
    );
    const after = engine.apply(r.state, { t: 'pass' });
    expect(after.state.units[DRYADS]!.charged).toBe(false);
    expect(after.events).toContainEqual(expect.objectContaining({ t: 'note' }));
  });
});

describe('combat phase', () => {
  // Dryads and Saurus Guard about 1" apart: both in combat.
  const start = arena('combat', 23.5);

  it('the active player picks first, must pick, and cannot pass', () => {
    expect(engine.decision(start)).toEqual({ kind: 'fightPick', player: 0, canPass: false });
    expect(engine.unitOptions(start, DRYADS)).toEqual([{ t: 'fight' }]);
    expect(engine.unitOptions(start, BELTHANOS)).toEqual([]);
    expect(() => engine.apply(start, { t: 'pass' })).toThrow(IllegalActionError);
    expect(engine.defaultAction(start)).toEqual({ t: 'fight', unit: DRYADS });
  });

  it('fight: pile in, then targets, then the other player picks, then the phase can end', () => {
    let s = engine.apply(start, { t: 'fight', unit: DRYADS }).state;
    expect(engine.decision(s)).toMatchObject({ kind: 'place', reason: 'pileIn', allowance: 3 });
    s = engine.apply(s, { t: 'pass' }).state;
    expect(engine.decision(s)).toMatchObject({ kind: 'targets', unit: DRYADS, mode: 'fight' });
    const options = engine.targetOptions(s, DRYADS, 'fight');
    expect(options[0]!.targets[0]).toMatchObject({ unit: SAURUS });
    expect(options[0]!.targets[0]!.modelsInRange).toBeGreaterThan(0);
    const r = engine.apply(s, engine.defaultAction(s));
    expect(r.events.some((e) => e.t === 'attacks' && e.attacker === DRYADS)).toBe(true);
    s = r.state;
    expect(engine.decision(s)).toEqual({ kind: 'fightPick', player: 1, canPass: false });
    s = engine.apply(s, { t: 'fight', unit: SAURUS }).state;
    s = engine.apply(s, { t: 'pass' }).state;
    s = engine.apply(s, engine.defaultAction(s)).state;
    expect(engine.decision(s)).toEqual({ kind: 'main', player: 0, phase: 'combat' });
    s = engine.apply(s, { t: 'pass' }).state;
    expect(s.phase).toBe('end');
  });

  it('when one player has no eligible unit the other keeps picking', () => {
    const s = editable(start);
    s.units[SAURUS]!.fought = true;
    s.fightPicker = 1;
    expect(engine.decision(s)).toEqual({ kind: 'fightPick', player: 0, canPass: false });
  });

  it('a unit that charged can fight even with no enemy left in range', () => {
    const s = editable(arena('combat', 40));
    s.units[DRYADS]!.charged = true;
    expect(engine.decision(s)).toMatchObject({ kind: 'fightPick', player: 0 });
    let t = engine.apply(s, { t: 'fight', unit: DRYADS }).state;
    t = engine.apply(t, { t: 'pass' }).state; // no pile-in; nothing to attack
    expect(engine.decision(t)).toMatchObject({ kind: 'main', phase: 'combat' });
  });

  it('pile-in: up to 3", no model further from the nearest enemy, and legal moves pass', () => {
    const wide = arena('combat', 25);
    const s = engine.apply(wide, { t: 'fight', unit: DRYADS }).state;
    const back = shiftPlacement(currentPlacement(s.units[DRYADS]!), -1, 0);
    expect(engine.checkPlacement(s, back).map((v) => v.code)).toContain('PILE_IN_FURTHER');
    const far = shiftPlacement(currentPlacement(s.units[DRYADS]!), 0, 3.5);
    expect(engine.checkPlacement(s, far).map((v) => v.code)).toContain('TOO_FAR');
    const p = pileInPlacement(engine, s, DRYADS)!;
    expect(engine.checkPlacement(s, p)).toEqual([]);
  });

  it('the defender may answer an attack with All-out Defence', () => {
    const s = editable(start);
    s.players[1].cp = 2;
    let t = engine.apply(s, { t: 'fight', unit: DRYADS }).state;
    t = engine.apply(t, { t: 'pass' }).state;
    t = engine.apply(t, engine.defaultAction(t)).state;
    const d = engine.decision(t);
    expect(d).toEqual({
      kind: 'reaction',
      player: 1,
      options: [{ command: 'allOutDefence', unit: SAURUS, cost: 1 }],
      trigger: `fight:${DRYADS}`,
    });
    expect(engine.defaultAction(t)).toEqual({ t: 'pass' });
    const r = engine.apply(t, { t: 'command', command: 'allOutDefence', unit: SAURUS });
    expect(r.events[0]).toEqual({
      t: 'command',
      player: 1,
      command: 'allOutDefence',
      unit: SAURUS,
    });
    expect(r.events.some((e) => e.t === 'attacks')).toBe(true);
    expect(r.state.players[1].cp).toBe(1);
  });
});

describe('retreat', () => {
  it('is the only move for a unit in combat; it costs D3 mortal damage and bars shooting and charging', () => {
    const s = arena('movement', 23.5);
    expect(engine.unitOptions(s, DRYADS)).toEqual([{ t: 'move', kind: 'retreat', allowance: 6 }]);
    const declared = engine.apply(s, { t: 'move', unit: DRYADS, kind: 'retreat' }).state;
    const away = shiftPlacement(currentPlacement(s.units[DRYADS]!), -6, 0);
    expect(engine.checkPlacement(declared, away)).toEqual([]);
    const r = engine.apply(declared, { t: 'place', placement: away });
    const roll = r.events.find((e) => e.t === 'roll');
    expect(roll).toMatchObject({ label: expect.stringContaining('Retreat') });
    expect(r.events).toContainEqual(
      expect.objectContaining({ t: 'damage', unit: DRYADS, source: 'Retreat' }),
    );
    const dryads = r.state.units[DRYADS]!;
    expect(dryads.moved).toBe('retreat');
    expect(dryads.models.filter((m) => !m.alive).length).toBe(
      roll?.t === 'roll' ? roll.dice[0] : -1,
    );
    const charge = passTo(engine, r.state, 'charge');
    expect(engine.unitOptions(charge, DRYADS)).toEqual([]);
  });
});
