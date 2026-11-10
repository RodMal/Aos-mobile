import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { createEngine, createScenario } from '../../engine/index.js';
import {
  faceEnemy,
  maxDistance,
  moveDraftTo,
  moveModel,
  placementCentre,
  reformDraft,
  rotateDraft,
  startDraft,
  translateDraft,
} from './placementEdit.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);
const state = engine.newGame(1);
const dryads = state.units['0:6']!;

describe('placement drafts', () => {
  it('starts where the unit stands, facing the enemy (towards +x for player 0)', () => {
    const d = startDraft(state, dryads);
    expect(d.placement.models).toHaveLength(10);
    expect(maxDistance(dryads, d.placement)).toBe(0);
    expect(d.facing).toBeGreaterThan(45);
    expect(d.facing).toBeLessThan(135);
  });

  it('translates every model by the same amount', () => {
    const d = translateDraft(startDraft(state, dryads), 3, -1);
    expect(maxDistance(dryads, d.placement)).toBeCloseTo(Math.hypot(3, 1));
    const c = placementCentre(moveDraftTo(d, { x: 20, y: 20 }).placement);
    expect(c.x).toBeCloseTo(20);
    expect(c.y).toBeCloseTo(20);
  });

  it('rotates rigidly about the centre', () => {
    const d = startDraft(state, dryads);
    const r = rotateDraft(d, 15);
    const c0 = placementCentre(d.placement);
    const c1 = placementCentre(r.placement);
    expect(c1.x).toBeCloseTo(c0.x);
    expect(c1.y).toBeCloseTo(c0.y);
    expect(r.facing).toBeCloseTo((d.facing + 15) % 360);
    const a = r.placement.models[0]!;
    const b = d.placement.models[0]!;
    expect(Math.hypot(a.x - c1.x, a.y - c1.y)).toBeCloseTo(Math.hypot(b.x - c0.x, b.y - c0.y));
  });

  it('rebuilds with a wider front rank', () => {
    const d = startDraft(state, dryads);
    const wide = reformDraft(scenario, dryads, d, d.facing, 10);
    expect(wide.frontage).toBe(10);
    expect(wide.placement.models).toHaveLength(10);
    const clamped = reformDraft(scenario, dryads, d, d.facing, 99);
    expect(clamped.frontage).toBe(10);
    // The rebuilt unit passes the engine's checks in place.
    const s = engine.apply(engine.apply(state, { t: 'pass' }).state, {
      t: 'move',
      unit: '0:6',
      kind: 'normal',
    }).state;
    expect(engine.checkPlacement(s, faceEnemy(scenario, s, dryads, d).placement)).toEqual([]);
  });

  it('moves a single model', () => {
    const d = moveModel(startDraft(state, dryads), 3, 0.5, 0);
    const moved = d.placement.models.find((m) => m.i === 3)!;
    expect(moved.x).toBeCloseTo(dryads.models[3]!.x + 0.5);
    expect(d.placement.models.filter((m) => m.x !== dryads.models[m.i]!.x)).toHaveLength(1);
  });
});
