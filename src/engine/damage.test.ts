import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { checkCoherencyFootprints } from '../geom/index.js';
import type { Ctx } from './ctx.js';
import { allocateDamage, casualtyOrder, inflictMortalDamage, returnPosition } from './damage.js';
import { createEngine, createScenario, unitFootprints, type GameState } from './index.js';
import { RngCursor } from './rng.js';
import { editable, keepOnly, placeUnit, ScriptedDice } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const fresh = createEngine(scenario).newGame(1);

function arena(): GameState {
  const s = editable(fresh);
  keepOnly(s, ['0:0', '0:6', '1:2', '1:7']);
  placeUnit(scenario, s, '0:6', 20, 22); // Dryads, 10 models, Health 1, champion is model 0
  placeUnit(scenario, s, '1:7', 32, 22); // Skinks
  placeUnit(scenario, s, '1:2', 45, 10); // Kroxigor, Health 6
  placeUnit(scenario, s, '0:0', 10, 35); // Alarielle, ward 5+
  return s;
}

function ctxFor(s: GameState, dice: number[] = []): Ctx {
  return { scenario, s, events: [], rng: dice.length ? new ScriptedDice(dice) : new RngCursor(1) };
}

describe('damage allocation', () => {
  it('slays a model each time the pool reaches Health and carries the rest', () => {
    const s = arena();
    const ctx = ctxFor(s);
    const krox = s.units['1:2']!;
    const r = allocateDamage(ctx, krox, 8, 'test');
    expect(r).toEqual({ taken: 8, slain: 1, destroyed: false });
    expect(krox.damage).toBe(2);
    expect(krox.models.filter((m) => !m.alive)).toHaveLength(1);
    expect(ctx.events).toContainEqual({
      t: 'damage',
      unit: '1:2',
      amount: 8,
      slain: 1,
      destroyed: false,
      source: 'test',
    });
    allocateDamage(ctx, krox, 4, 'test');
    expect(krox.damage).toBe(0);
    expect(krox.models.filter((m) => !m.alive)).toHaveLength(2);
  });

  it('destroys a unit with no models left and clears its pool', () => {
    const s = arena();
    const dryads = s.units['0:6']!;
    const r = allocateDamage(ctxFor(s), dryads, 15, 'test');
    expect(r.destroyed).toBe(true);
    expect(dryads.status).toBe('destroyed');
    expect(dryads.damage).toBe(0);
    expect(dryads.models.every((m) => !m.alive)).toBe(true);
  });

  it('takes non-champions first, furthest from the enemy first', () => {
    const s = arena();
    const dryads = s.units['0:6']!;
    const order = casualtyOrder(scenario, s, dryads);
    expect(order.at(-1)).toBe(0); // the champion goes last
    const furthest = order[0]!;
    // The Skinks are to the right (larger x): the first casualty is among the leftmost.
    const xs = dryads.models.slice(1).map((m) => m.x);
    expect(dryads.models[furthest]!.x).toBeLessThanOrEqual(Math.min(...xs) + 1.5);
  });

  it('keeps the unit coherent as models are removed', () => {
    const s = arena();
    const dryads = s.units['0:6']!;
    const ctx = ctxFor(s);
    for (let i = 0; i < 8; i++) {
      allocateDamage(ctx, dryads, 1, 'test');
      expect(checkCoherencyFootprints(unitFootprints(scenario, dryads)).coherent).toBe(true);
    }
  });

  it('mortal damage is warded point by point', () => {
    const s = arena();
    const alarielle = s.units['0:0']!;
    const ctx = ctxFor(s, [5, 2, 6]);
    const r = inflictMortalDamage(ctx, alarielle, 3, 'test');
    expect(r.taken).toBe(1);
    expect(alarielle.damage).toBe(1);
    expect(ctx.events[0]).toEqual({ t: 'roll', player: 0, label: 'Ward', dice: [5, 2, 6] });
  });
});

describe('returning slain models', () => {
  it('finds a spot in coherency, off other bases and away from the enemy', () => {
    const s = arena();
    const dryads = s.units['0:6']!;
    allocateDamage(ctxFor(s), dryads, 3, 'test');
    const dead = dryads.models.findIndex((m) => !m.alive);
    const at = returnPosition(scenario, s, dryads, dead)!;
    expect(at).not.toBeNull();
    Object.assign(dryads.models[dead]!, at, { alive: true });
    expect(checkCoherencyFootprints(unitFootprints(scenario, dryads)).coherent).toBe(true);
  });
});
