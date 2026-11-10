import { describe, expect, it } from 'vitest';
import {
  baseDiameterIn,
  baseFootprint,
  footprintPolygon,
  mmToInches,
  MM_PER_INCH,
} from './index.js';
import { oval, round } from './test-helpers.js';

describe('scale', () => {
  it('a 32mm base is 1.2598" across', () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(baseDiameterIn(32)).toBeCloseTo(1.2598, 4);
    expect(mmToInches(25.4)).toBe(1);
  });

  it('round bases become circles with radius mm / 2 / 25.4 (ADR 0009)', () => {
    expect(baseFootprint(round(32), 1, 2)).toEqual({
      kind: 'circle',
      cx: 1,
      cy: 2,
      r: 32 / 2 / 25.4,
    });
  });

  it('oval bases become ellipses with the length on the local x axis', () => {
    const fp = baseFootprint(oval(60, 35), 0, 0, 30);
    expect(fp).toEqual({
      kind: 'ellipse',
      cx: 0,
      cy: 0,
      rx: 30 / 25.4,
      ry: 17.5 / 25.4,
      rotation: 30,
    });
  });

  it('"Use model" falls back to the 32mm round base', () => {
    expect(baseFootprint({ kind: 'useModel' }, 0, 0)).toEqual(baseFootprint(round(32), 0, 0));
  });

  it('base polygons are 24-gons (rectangles: 4 corners)', () => {
    expect(footprintPolygon(baseFootprint(round(32), 0, 0))).toHaveLength(24);
    expect(footprintPolygon(baseFootprint(oval(60, 35), 0, 0))).toHaveLength(24);
    expect(
      footprintPolygon(baseFootprint({ kind: 'rect', lengthMm: 50, widthMm: 25 }, 0, 0)),
    ).toHaveLength(4);
  });
});
