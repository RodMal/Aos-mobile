import { describe, expect, it } from 'vitest';
import { declutter, estimateTextWidth, zoomBucket } from './declutter.js';

describe('declutter', () => {
  it('keeps the higher-priority label when two overlap', () => {
    const shown = declutter([
      { key: 'a', x: 0, y: 0, w: 60, h: 14, priority: 1 },
      { key: 'b', x: 20, y: 4, w: 60, h: 14, priority: 5 },
      { key: 'c', x: 200, y: 0, w: 60, h: 14, priority: 0 },
    ]);
    expect([...shown].sort()).toEqual(['b', 'c']);
  });

  it('estimates text width and buckets zoom', () => {
    expect(estimateTextWidth('Dryads', 12)).toBeCloseTo(40.32);
    expect(zoomBucket(10)).toBeLessThanOrEqual(10);
    expect(zoomBucket(10)).toBeGreaterThan(8);
    expect(zoomBucket(10.1)).toBe(zoomBucket(10.2));
  });
});
