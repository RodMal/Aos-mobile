import { describe, expect, it } from 'vitest';
import {
  centreOn,
  clampScale,
  clampView,
  fitScale,
  fitView,
  frameView,
  isVisible,
  panBy,
  rotationFor,
  screenDeltaToTable,
  screenToTable,
  svgMatrix,
  tableToScreen,
  zoomAbout,
  type Rot,
  type View,
  type Viewport,
} from './view.js';

const table = { w: 60, h: 44 };
const vp: Viewport = { w: 412, h: 800, insetTop: 0, insetBottom: 200 };

function close(a: { x: number; y: number }, b: { x: number; y: number }): void {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe('table <-> screen', () => {
  for (const rot of [0, 90, -90] as Rot[]) {
    it(`round-trips at rot ${rot}`, () => {
      const v: View = { scale: 7.5, tx: 33, ty: -12, rot };
      for (const p of [
        { x: 0, y: 0 },
        { x: 60, y: 44 },
        { x: 12.3, y: 40.1 },
      ]) {
        close(screenToTable(v, tableToScreen(v, p)), p);
      }
    });

    it(`matches the SVG matrix at rot ${rot}`, () => {
      const v: View = { scale: 3, tx: 10, ty: 20, rot };
      const [a, b, c, d, e, f] = svgMatrix(v);
      const p = { x: 5, y: 7 };
      close({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }, tableToScreen(v, p));
    });
  }

  it('puts player 0 (left of the table) at the bottom of the screen', () => {
    const v = fitView(vp, table, rotationFor(0));
    const left = tableToScreen(v, { x: 0, y: 22 });
    const right = tableToScreen(v, { x: 60, y: 22 });
    expect(left.y).toBeGreaterThan(right.y);
  });

  it('puts player 1 (right of the table) at the bottom of the screen', () => {
    const v = fitView(vp, table, rotationFor(1));
    expect(tableToScreen(v, { x: 60, y: 22 }).y).toBeGreaterThan(
      tableToScreen(v, { x: 0, y: 22 }).y,
    );
  });

  it('converts screen deltas to table deltas', () => {
    const v: View = { scale: 10, tx: 0, ty: 0, rot: -90 };
    // With rot -90, screen up is table +x.
    close(screenDeltaToTable(v, { x: 0, y: -30 }), { x: 3, y: 0 });
  });
});

describe('fit, zoom and clamp', () => {
  it('fits the rotated table into the visible area and centres it', () => {
    const v = fitView(vp, table, -90);
    const corners = [
      { x: 0, y: 0 },
      { x: 60, y: 44 },
    ].map((p) => tableToScreen(v, p));
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(-1e-6);
      expect(c.x).toBeLessThanOrEqual(vp.w + 1e-6);
      expect(c.y).toBeGreaterThanOrEqual(-1e-6);
      expect(c.y).toBeLessThanOrEqual(vp.h - vp.insetBottom + 1e-6);
    }
    close(tableToScreen(v, { x: 30, y: 22 }), { x: 206, y: 300 });
    expect(v.scale).toBeCloseTo(fitScale(vp, table, -90), 9);
  });

  it('zooms about a point, keeping it fixed', () => {
    const v = fitView(vp, table, -90);
    const at = { x: 100, y: 150 };
    const before = screenToTable(v, at);
    const z = zoomAbout(v, 2, at, vp, table);
    expect(z.scale).toBeCloseTo(v.scale * 2, 9);
    close(screenToTable(z, at), before);
  });

  it('clamps the zoom range', () => {
    const fit = fitScale(vp, table, -90);
    expect(clampScale(0.001, vp, table, -90)).toBeCloseTo(fit * 0.85, 9);
    expect(clampScale(1e6, vp, table, -90)).toBe(160);
  });

  it('keeps a zoomed-in table from being dragged away', () => {
    const v = centreOn(fitView(vp, table, -90), { x: 30, y: 22 }, vp, 40);
    const far = clampView(panBy(v, 5000, 5000), vp, table);
    const tl = tableToScreen(far, { x: 0, y: 44 });
    // The table's top-left on screen (table x=60,y=0 for rot -90) can sit at most 48px in.
    const corner = tableToScreen(far, { x: 60, y: 0 });
    expect(Math.min(tl.x, corner.x)).toBeLessThanOrEqual(48 + 1e-6);
    expect(Math.min(tl.y, corner.y)).toBeLessThanOrEqual(48 + 1e-6);
  });

  it('keeps a small table inside the visible area', () => {
    const v = fitView(vp, table, -90);
    const moved = clampView(panBy(v, 0, 900), vp, table);
    const bottom = Math.max(
      tableToScreen(moved, { x: 0, y: 0 }).y,
      tableToScreen(moved, { x: 60, y: 44 }).y,
    );
    expect(bottom).toBeLessThanOrEqual(vp.h - vp.insetBottom + 1e-6);
  });

  it('centres on a point', () => {
    const v = centreOn(fitView(vp, table, 90), { x: 10, y: 10 }, vp, 50);
    close(tableToScreen(v, { x: 10, y: 10 }), { x: 206, y: 300 });
    expect(isVisible(v, { x: 10, y: 10 }, vp)).toBe(true);
    expect(isVisible(v, { x: 50, y: 40 }, vp)).toBe(false);
  });
});

describe('frameView', () => {
  const vp: Viewport = { w: 400, h: 800, insetTop: 0, insetBottom: 200 };

  it('fits every point in the visible area and centres them', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 30, y: 20 },
    ];
    const v = frameView({ scale: 5, tx: 0, ty: 0, rot: 0 }, points, vp, 100, 50);
    for (const p of points) {
      const s = tableToScreen(v, p);
      expect(s.x).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(s.x).toBeLessThanOrEqual(350 + 1e-9);
      expect(s.y).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(s.y).toBeLessThanOrEqual(550 + 1e-9);
    }
    const mid = tableToScreen(v, { x: 20, y: 15 });
    expect(mid.x).toBeCloseTo(200);
    expect(mid.y).toBeCloseTo(300);
  });

  it('never zooms in beyond the maximum scale, even for a single point', () => {
    const v = frameView({ scale: 5, tx: 0, ty: 0, rot: 0 }, [{ x: 10, y: 10 }], vp, 34);
    expect(v.scale).toBe(34);
  });
});
