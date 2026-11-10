import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import {
  checkCoherencyFootprints,
  footprintDistanceToPolygon,
  footprintInsidePolygon,
  footprintsOverlap,
} from '../geom/index.js';
import {
  createEngine,
  createScenario,
  currentPlacement,
  IllegalActionError,
  shiftPlacement,
  unitFootprints,
  unitsOf,
  type Action,
  type GameState,
} from './index.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

function passTo(state: GameState, phase: GameState['phase']): GameState {
  let s = state;
  while (s.phase !== phase) s = engine.apply(s, { t: 'pass' }).state;
  return s;
}

describe('set-up', () => {
  const state = engine.newGame(1);

  it('puts every unit of both armies on the battlefield', () => {
    expect(unitsOf(state, 0)).toHaveLength(8);
    expect(unitsOf(state, 1)).toHaveLength(9);
    expect(state.round).toBe(1);
    expect(state.players[0].cp).toBe(4);
  });

  it('deploys legally: in own territory, 9" from enemy territory, coherent, no overlaps', () => {
    const { battlefield, sides } = scenario;
    const all = state.unitOrder.map((id) => state.units[id]!);
    for (const unit of all) {
      const own = battlefield.territories[sides[unit.owner]];
      const enemy = battlefield.territories[sides[unit.owner === 0 ? 1 : 0]];
      const fps = unitFootprints(scenario, unit);
      expect(checkCoherencyFootprints(fps).coherent, unit.name).toBe(true);
      for (const fp of fps) {
        expect(
          own.some((p) => footprintInsidePolygon(fp, p)),
          unit.name,
        ).toBe(true);
        for (const p of enemy) {
          expect(footprintDistanceToPolygon(fp, p), unit.name).toBeGreaterThanOrEqual(9);
        }
      }
    }
    const fps = all.flatMap((u) => unitFootprints(scenario, u));
    for (let a = 0; a < fps.length; a++) {
      for (let b = a + 1; b < fps.length; b++) {
        expect(footprintsOverlap(fps[a]!, fps[b]!)).toBe(false);
      }
    }
  });

  it('is deterministic for a seed', () => {
    expect(engine.newGame(1)).toEqual(state);
  });
});

describe('turn sequence', () => {
  it('runs five rounds of two turns and then ends', () => {
    let s = engine.newGame(7);
    let steps = 0;
    while (engine.decision(s)) {
      s = engine.apply(s, engine.defaultAction(s)).state;
      steps++;
    }
    expect(steps).toBe(5 * 2 * 6);
    expect(s.status).toBe('ended');
    expect(s.round).toBe(5);
  });

  it('does not mutate the state it is given', () => {
    const s = engine.newGame(3);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    engine.apply(s, { t: 'pass' });
    expect(s).toEqual(copy);
  });

  it('survives a JSON round trip', () => {
    const s = passTo(engine.newGame(3), 'movement');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('movement', () => {
  const start = passTo(engine.newGame(11), 'movement');
  const dryads = unitsOf(start, 0).find((u) => u.name === 'Dryads')!;

  it('offers a normal move and a run in the movement phase only', () => {
    expect(engine.unitOptions(start, dryads.id).map((o) => o.t === 'move' && o.kind)).toEqual([
      'normal',
      'run',
    ]);
    expect(engine.unitOptions(engine.newGame(11), dryads.id)).toEqual([]);
    const enemy = unitsOf(start, 1)[0]!;
    expect(engine.unitOptions(start, enemy.id)).toEqual([]);
  });

  it('moves a unit within its allowance and marks it as moved', () => {
    let s = engine.apply(start, { t: 'move', unit: dryads.id, kind: 'normal' }).state;
    const d = engine.decision(s);
    expect(d).toMatchObject({ kind: 'place', unit: dryads.id, allowance: 6, player: 0 });
    const placement = shiftPlacement(currentPlacement(dryads), 5, 0);
    expect(engine.checkPlacement(s, placement)).toEqual([]);
    const result = engine.apply(s, { t: 'place', placement });
    s = result.state;
    expect(s.units[dryads.id]!.models[0]!.x).toBeCloseTo(dryads.models[0]!.x + 5);
    expect(s.units[dryads.id]!.moved).toBe('normal');
    expect(result.events).toContainEqual(
      expect.objectContaining({ t: 'moved', unit: dryads.id, kind: 'normal' }),
    );
    expect(engine.unitOptions(s, dryads.id)).toEqual([]);
    expect(engine.decision(s)).toMatchObject({ kind: 'main', phase: 'movement' });
  });

  it('refuses a move beyond the allowance, with the reason', () => {
    const s = engine.apply(start, { t: 'move', unit: dryads.id, kind: 'normal' }).state;
    const placement = shiftPlacement(currentPlacement(dryads), 6.5, 0);
    expect(engine.checkPlacement(s, placement).map((v) => v.code)).toEqual(['TOO_FAR']);
    const attempt = (): unknown => engine.apply(s, { t: 'place', placement });
    expect(attempt).toThrow(IllegalActionError);
    expect(attempt).toThrow(/6"/);
  });

  it('refuses a placement that breaks coherency or leaves the battlefield', () => {
    const s = engine.apply(start, { t: 'move', unit: dryads.id, kind: 'normal' }).state;
    const split = currentPlacement(dryads);
    split.models[0] = { ...split.models[0]!, y: split.models[0]!.y + 6 };
    expect(engine.checkPlacement(s, split).map((v) => v.code)).toContain('COHERENCY');
    const off = shiftPlacement(currentPlacement(dryads), -60, 0);
    expect(engine.checkPlacement(s, off).map((v) => v.code)).toContain('OFF_BOARD');
  });

  it('a run adds a D6 and is committed once rolled', () => {
    const result = engine.apply(start, { t: 'move', unit: dryads.id, kind: 'run' });
    const d = engine.decision(result.state);
    if (d?.kind !== 'place') throw new Error('expected a place decision');
    expect(d.dice).toHaveLength(1);
    expect(d.allowance).toBe(6 + d.dice[0]!);
    const stayed = engine.apply(result.state, { t: 'pass' }).state;
    expect(stayed.units[dryads.id]!.moved).toBe('run');
  });

  it('cancelling a normal move leaves the unit free to move', () => {
    const s = engine.apply(start, { t: 'move', unit: dryads.id, kind: 'normal' }).state;
    const back = engine.apply(s, { t: 'pass' }).state;
    expect(back.units[dryads.id]!.moved).toBeNull();
    expect(engine.unitOptions(back, dryads.id)).toHaveLength(2);
  });

  it('cannot move within 3" of an enemy unit', () => {
    const enemy = unitsOf(start, 1)[0]!;
    const target = enemy.models[0]!;
    const s0: GameState = JSON.parse(JSON.stringify(start));
    // Leave one enemy unit on the table and stand the Dryads 8" to its left.
    for (const other of unitsOf(s0, 1)) if (other.id !== enemy.id) other.status = 'destroyed';
    const unit = s0.units[dryads.id]!;
    const leftmost = Math.min(...s0.units[enemy.id]!.models.map((m) => m.x));
    const rightmost = Math.max(...unit.models.map((m) => m.x));
    const dx = leftmost - 8 - rightmost;
    const dy = target.y - unit.models[0]!.y;
    unit.models.forEach((m) => {
      m.x += dx;
      m.y += dy;
    });
    const s = engine.apply(s0, { t: 'move', unit: dryads.id, kind: 'normal' }).state;
    const codes = engine
      .checkPlacement(s, shiftPlacement(currentPlacement(unit), 5, 0))
      .map((v) => v.code);
    expect(codes).toContain('ENEMY_COMBAT_RANGE');
  });

  it('rejects actions that do not fit the decision', () => {
    const bad: Action[] = [
      { t: 'charge', unit: dryads.id },
      { t: 'move', unit: unitsOf(start, 1)[0]!.id, kind: 'normal' },
    ];
    for (const a of bad) expect(() => engine.apply(start, a)).toThrow(IllegalActionError);
  });
});
