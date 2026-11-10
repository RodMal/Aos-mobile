import { describe, expect, it } from 'vitest';
import type { Footprint } from '../../geom/index.js';
import { distanceToFootprint, hitTest, pick } from './hitTest.js';

const circle = (cx: number, cy: number, r = 0.5): Footprint => ({ kind: 'circle', cx, cy, r });

describe('distanceToFootprint', () => {
  it('measures circles edge to edge', () => {
    expect(distanceToFootprint(circle(0, 0, 1), { x: 3, y: 0 })).toBeCloseTo(2);
    expect(distanceToFootprint(circle(0, 0, 1), { x: 0.5, y: 0 })).toBe(0);
  });

  it('respects ellipse rotation', () => {
    const fp: Footprint = { kind: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 1, rotation: 90 };
    // Rotated 90 degrees: the long axis runs along y.
    expect(distanceToFootprint(fp, { x: 0, y: 2.5 })).toBe(0);
    expect(distanceToFootprint(fp, { x: 2, y: 0 })).toBeCloseTo(1);
  });

  it('measures rectangles', () => {
    const fp: Footprint = { kind: 'rect', cx: 0, cy: 0, hw: 2, hh: 1, rotation: 0 };
    expect(distanceToFootprint(fp, { x: 5, y: 5 })).toBeCloseTo(5);
    expect(distanceToFootprint(fp, { x: 1, y: 0.5 })).toBe(0);
  });
});

describe('hitTest and pick', () => {
  const targets = [
    { key: 'a', footprints: [circle(0, 0), circle(1.2, 0)] },
    { key: 'b', footprints: [circle(3, 0)] },
  ];

  it('returns targets within the slop, nearest first', () => {
    const hits = hitTest(targets, { x: 2.1, y: 0 }, 1);
    expect(hits.map((h) => h.key)).toEqual(['b', 'a']);
  });

  it('picks the one target a tap is inside', () => {
    expect(pick(hitTest(targets, { x: 0, y: 0 }, 1))).toEqual({ t: 'one', key: 'a' });
  });

  it('asks to choose when the tap is between targets', () => {
    expect(pick(hitTest(targets, { x: 2.1, y: 0 }, 1))).toEqual({ t: 'choose', keys: ['b', 'a'] });
  });

  it('returns none far from everything', () => {
    expect(pick(hitTest(targets, { x: 20, y: 0 }, 1))).toEqual({ t: 'none' });
  });
});
