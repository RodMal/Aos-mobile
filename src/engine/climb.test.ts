/** Core 15.2: climbing terrain taller than 1" counts its height up and down, unless FLY. */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { climbHeight } from '../data/battlefield.js';
import { createEngine, createScenario, formPlacement, profileOf } from './index.js';
import { checkMovePlacement } from './movement.js';
import { hasEffectiveKeyword } from './abilities/effects.js';
import { editable, keepOnly, placeUnit, startGame } from './test-helpers.js';
import type { GameState, Placement, UnitId } from './types.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const spire = scenario.battlefield.terrain.find((t) => t.id === 'spire-e')!; // (53, 17), 5" square
const ruin = scenario.battlefield.terrain.find((t) => t.kind === 'ruin')!;

function pick(): { walker: UnitId; flyer: UnitId } {
  const s = startGame(engine, 1);
  const own = s.unitOrder.filter(
    (id) => s.units[id]!.owner === 0 && !profileOf(scenario, s.units[id]!).isFactionTerrain,
  );
  const flies = (id: UnitId) => hasEffectiveKeyword(scenario, s, s.units[id]!, 'FLY');
  const single = (id: UnitId) => s.units[id]!.models.length === 1;
  const walker = own.find((id) => !flies(id) && single(id));
  const flyer = own.find((id) => flies(id) && single(id));
  if (!walker || !flyer) throw new Error('need a lone walker and a lone flyer');
  return { walker, flyer };
}

/** The unit starts 3" west of the spire and moves to 3" east of it, in a straight line over it. */
function crossing(id: UnitId): { s: GameState; p: Placement; flat: number } {
  const s = editable(startGame(engine, 1));
  const enemy = s.unitOrder.find((u) => s.units[u]!.owner === 1)!;
  keepOnly(s, [id, enemy]);
  placeUnit(scenario, s, enemy, 10, 40, 0);
  const xs = spire.polygon.map((q) => q[0]);
  const x0 = Math.min(...xs) - 3;
  const x1 = Math.max(...xs) + 3;
  placeUnit(scenario, s, id, x0, 17, 0);
  const p = formPlacement(scenario, s.units[id]!, { x: x1, y: 17 }, 0);
  return { s, p, flat: x1 - x0 };
}

const codes = (c: { s: GameState; p: Placement }, id: UnitId, allowance: number): string[] =>
  checkMovePlacement(scenario, c.s, c.s.units[id]!, c.p, { reason: 'normal', allowance }).map(
    (v) => v.code,
  );

describe('climbing terrain (Core 15.2)', () => {
  it('only terrain over 1" tall counts as a climb: spires yes, ruins and outcrops no', () => {
    expect(climbHeight(spire)).toBeGreaterThan(1);
    for (const t of scenario.battlefield.terrain.filter((f) => f.kind !== 'spire')) {
      expect(climbHeight(t)).toBe(0);
    }
  });

  it('a walker crossing a spire pays the climb up and down', () => {
    const { walker } = pick();
    const c = crossing(walker);
    const climb = 2 * climbHeight(spire);
    expect(codes(c, walker, c.flat + 0.01)).toContain('TOO_FAR');
    expect(codes(c, walker, c.flat + climb - 0.01)).toContain('TOO_FAR');
    expect(codes(c, walker, c.flat + climb + 0.01)).not.toContain('TOO_FAR');
  });

  it('a flyer crossing a spire pays nothing', () => {
    const { flyer } = pick();
    const c = crossing(flyer);
    expect(codes(c, flyer, c.flat + 0.01)).not.toContain('TOO_FAR');
  });

  it('a walker crossing a ruin pays nothing', () => {
    const { walker } = pick();
    const s = editable(startGame(engine, 1));
    const enemy = s.unitOrder.find((u) => s.units[u]!.owner === 1)!;
    keepOnly(s, [walker, enemy]);
    placeUnit(scenario, s, enemy, 10, 40, 0);
    const cx = ruin.polygon.reduce((a, q) => a + q[0], 0) / ruin.polygon.length;
    const cy = ruin.polygon.reduce((a, q) => a + q[1], 0) / ruin.polygon.length;
    placeUnit(scenario, s, walker, cx - 4, cy, 0);
    const p = formPlacement(scenario, s.units[walker]!, { x: cx + 4, y: cy }, 0);
    const v = checkMovePlacement(scenario, s, s.units[walker]!, p, {
      reason: 'normal',
      allowance: 8.01,
    });
    expect(v.map((x) => x.code)).not.toContain('TOO_FAR');
  });
});
