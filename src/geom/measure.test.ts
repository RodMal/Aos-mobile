import { describe, expect, it } from 'vitest';
import { baseFootprint, measureGroups, pointFootprint } from './index.js';
import { round } from './test-helpers.js';

const r32 = 32 / 2 / 25.4;

describe('measureGroups', () => {
  it('point to point is the straight distance', () => {
    const r = measureGroups([pointFootprint(0, 0)], [pointFootprint(3, 4)])!;
    expect(r.gap).toBeCloseTo(5, 12);
  });

  it('unit to point is measured from the base edge, not the centre', () => {
    const r = measureGroups([baseFootprint(round(32), 10, 10)], [pointFootprint(10, 19)])!;
    expect(r.gap).toBeCloseTo(9 - r32, 12);
    expect(r.a[1]).toBeCloseTo(10 + r32, 12);
  });

  it('unit to unit uses the closest pair of bases', () => {
    const near = baseFootprint(round(32), 0, 0);
    const far = baseFootprint(round(32), 0, -20);
    const other = baseFootprint(round(32), 10, 0);
    const r = measureGroups([near, far], [other])!;
    expect(r.gap).toBeCloseTo(10 - 2 * r32, 12);
  });

  it('is 0 for overlapping bases and null for an empty group', () => {
    const a = baseFootprint(round(32), 0, 0);
    expect(measureGroups([a], [baseFootprint(round(32), 0.5, 0)])!.gap).toBe(0);
    expect(measureGroups([], [a])).toBeNull();
  });
});
