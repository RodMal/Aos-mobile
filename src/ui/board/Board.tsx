/** The battlefield: one SVG, one view transform, touch gestures and the camera. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { modelFootprint, unitCentre, unitFootprints } from '../../engine/index.js';
import { scenario, engine } from '../game/engine.js';
import { editDraft } from '../game/draftActions.js';
import { useGame } from '../game/instance.js';
import { useHuman } from '../game/hooks.js';
import { assignAll } from '../game/attackPlan.js';
import { moveModel, translateDraft } from '../game/placementEdit.js';
import { useUi } from '../game/uiStore.js';
import { GhostLayer } from './GhostLayer.js';
import { zoomBucket } from './declutter.js';
import { hitTest, pick, type HitTarget } from './hitTest.js';
import {
  Defs,
  LabelsLayer,
  ObjectivesLayer,
  RangeLayer,
  TableLayer,
  UnitsLayer,
} from './layers.js';
import { useGestures, type GestureHandlers, type GestureRefs } from './useGestures.js';
import {
  centreOn,
  frameView,
  clampScale,
  clampView,
  fitScale,
  fitView,
  isVisible,
  lerpView,
  rotationFor,
  screenToTable,
  svgTransform,
  visibleCentre,
  zoomAbout,
  type Pt,
  type Rot,
  type View,
  type Viewport,
} from './view.js';

/** The width at which styles.css puts the sheet beside the board. */
const WIDE_LAYOUT = '(min-width: 820px)';
const TABLE = { w: scenario.battlefield.width, h: scenario.battlefield.height };
/** Finger slop for picking, in screen pixels. */
const SLOP_PX = 22;
/** Zoom used when the camera flies to a unit. */
const FOCUS_SCALE = 34;

function placingNow(): boolean {
  const { session } = useGame.getState();
  const d = engine.decision(session.state);
  return !!d && d.kind === 'place' && d.player === session.humanPlayer && !!useUi.getState().draft;
}

export function Board() {
  const human = useHuman();
  const draft = useUi((s) => s.draft);
  // On a wide window the table is shown the way it is laid out (60" across the screen) instead
  // of turned to run down a portrait phone; the phone layout never takes this branch.
  const [landscape, setLandscape] = useState(false);
  const rot: Rot = landscape ? 0 : rotationFor(human);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const viewRef = useRef<View | null>(null);
  const vpRef = useRef<Viewport | null>(null);
  const handlersRef = useRef<GestureHandlers | null>(null);
  const frame = useRef(0);
  const anim = useRef(0);
  const userMoved = useRef(false);
  const pendingDrag = useRef({ kind: 'ghost' as 'ghost' | 'model', dx: 0, dy: 0, raf: 0 });

  const refs = useMemo<GestureRefs>(() => {
    const apply = () => {
      frame.current = 0;
      const v = viewRef.current;
      const g = gRef.current;
      const svg = svgRef.current;
      if (!v || !g || !svg) return;
      g.setAttribute('transform', svgTransform(v));
      svg.style.setProperty('--k', String(1 / v.scale));
      svg.dataset.scale = v.scale.toFixed(3);
      const bucket = zoomBucket(v.scale);
      if (useUi.getState().zoomBucket !== bucket) useUi.setState({ zoomBucket: bucket });
    };
    return {
      view: viewRef,
      viewport: vpRef,
      table: TABLE,
      handlers: handlersRef,
      schedule: () => {
        if (!frame.current) frame.current = requestAnimationFrame(apply);
      },
    };
  }, []);

  const setView = (v: View, animate = false) => {
    cancelAnimationFrame(anim.current);
    const vp = vpRef.current;
    const target = vp ? clampView(v, vp, TABLE) : v;
    const from = viewRef.current;
    if (!animate || !from || useGame.getState().fast) {
      viewRef.current = target;
      refs.schedule();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 280);
      const e = 1 - (1 - t) ** 3;
      viewRef.current = lerpView(from, target, e);
      refs.schedule();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  // Gestures talk to the stores through these handlers (they only read refs and stores).
  useLayoutEffect(() => {
    handlersRef.current = {
      dragKindAt(p: Pt) {
        if (!placingNow()) return 'pan';
        const draft = useUi.getState().draft!;
        if (!draft.adjust) return 'ghost';
        const v = viewRef.current!;
        const unit = useGame.getState().session.state.units[draft.unit]!;
        const targets: HitTarget<number>[] = draft.placement.models.map((m) => ({
          key: m.i,
          footprints: [modelFootprint(scenario, unit, m.i, m)],
        }));
        const hits = hitTest(targets, screenToTable(v, p), SLOP_PX / v.scale);
        if (hits.length > 0) {
          useUi.getState().setDraft({ ...draft, activeModel: hits[0]!.key });
          return 'model';
        }
        return draft.activeModel !== null ? 'model' : 'pan';
      },
      onDrag(kind, dx, dy) {
        const pd = pendingDrag.current;
        pd.kind = kind;
        pd.dx += dx;
        pd.dy += dy;
        if (pd.raf) return;
        pd.raf = requestAnimationFrame(() => {
          const { dx: x, dy: y, kind: k } = pd;
          pd.dx = 0;
          pd.dy = 0;
          pd.raf = 0;
          editDraft((d) =>
            k === 'model' && d.activeModel !== null
              ? moveModel(d, d.activeModel, x, y)
              : translateDraft(d, x, y),
          );
        });
      },
      onDragEnd() {},
      onPointerDown() {
        cancelAnimationFrame(anim.current);
      },
      onUserView() {
        userMoved.current = true;
        cancelAnimationFrame(anim.current);
      },
      onTap(p) {
        const v = viewRef.current;
        if (!v) return;
        const at = screenToTable(v, p);
        const slop = SLOP_PX / v.scale;
        const ui = useUi.getState();
        const state = useGame.getState().session.state;
        if (placingNow()) {
          const draft = ui.draft!;
          if (!draft.adjust) return;
          const unit = state.units[draft.unit]!;
          const hits = hitTest(
            draft.placement.models.map((m) => ({
              key: m.i,
              footprints: [modelFootprint(scenario, unit, m.i, m)],
            })),
            at,
            slop,
          );
          if (hits.length > 0) ui.setDraft({ ...draft, activeModel: hits[0]!.key });
          return;
        }
        const units: HitTarget<string>[] = state.unitOrder
          .map((id) => state.units[id]!)
          .filter((u) => u.status === 'battlefield')
          .map((u) => ({ key: u.id, footprints: unitFootprints(scenario, u) }));
        if (ui.attack) {
          const attack = ui.attack;
          const legal = new Set(attack.options.flatMap((o) => o.targets.map((t) => t.unit)));
          const hits = hitTest(
            units.filter((u) => legal.has(u.key)),
            at,
            slop,
          );
          if (hits.length > 0)
            ui.setAttack({ ...attack, plan: assignAll(attack.plan, attack.options, hits[0]!.key) });
          return;
        }
        if (ui.abilityPick) {
          const picking = ui.abilityPick;
          const legal = new Set(picking.option.targets ?? []);
          const hits = hitTest(
            units.filter((u) => legal.has(u.key)),
            at,
            slop,
          );
          if (hits.length > 0) ui.setAbilityPick({ ...picking, target: hits[0]!.key });
          return;
        }
        const result = pick(hitTest(units, at, slop));
        if (result.t === 'one') ui.select(result.key);
        else if (result.t === 'choose') ui.setChooser({ units: result.keys, x: p.x, y: p.y });
        else ui.select(null);
      },
    };
  }, []);

  useGestures(svgRef, refs);

  // Landscape when the sheet sits beside the board (the wide layout) and the board is wider
  // than tall; the margin keeps it from flipping back and forth around a square window.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const check = () => {
      const r = svg.getBoundingClientRect();
      const wide = window.matchMedia(WIDE_LAYOUT).matches;
      setLandscape((was) => wide && r.width > 0 && r.width / r.height >= (was ? 1.0 : 1.15));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Size: fit on first layout and keep the view valid as the viewport changes.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      const prevVp = vpRef.current;
      const vp: Viewport = {
        w: r.width,
        h: r.height,
        insetTop: 0,
        insetBottom: useUi.getState().sheetHeight,
      };
      vpRef.current = vp;
      const v = viewRef.current;
      if (!v || !userMoved.current || v.rot !== rot) {
        viewRef.current = fitView(vp, TABLE, rot);
      } else if (prevVp && (Math.abs(prevVp.w - vp.w) > 1 || Math.abs(prevVp.h - vp.h) > 1)) {
        const focus = screenToTable(v, visibleCentre(prevVp));
        const ratio = fitScale(vp, TABLE, rot) / Math.max(1e-6, fitScale(prevVp, TABLE, rot));
        const scale = clampScale(v.scale * ratio, vp, TABLE, rot);
        viewRef.current = clampView(centreOn(v, focus, vp, scale), vp, TABLE);
      } else {
        viewRef.current = clampView(
          { ...v, scale: clampScale(v.scale, vp, TABLE, rot) },
          vp,
          TABLE,
        );
      }
      refs.schedule();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    const unsub = useUi.subscribe((s, prev) => {
      if (s.sheetHeight !== prev.sheetHeight) measure();
    });
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [rot, refs]);

  // Camera requests from the rest of the UI.
  const camera = useUi((s) => s.camera);
  useEffect(() => {
    const v = viewRef.current;
    const vp = vpRef.current;
    if (!camera || !v || !vp) return;
    if (camera.kind === 'fit') {
      userMoved.current = false;
      setView(fitView(vp, TABLE, rot), true);
    } else if (camera.kind === 'zoom') {
      userMoved.current = true;
      setView(zoomAbout(v, camera.factor, visibleCentre(vp), vp, TABLE), true);
    } else if (camera.kind === 'frame') {
      const units = useGame.getState().session.state.units;
      const points = camera.units.flatMap((id) => {
        const u = units[id];
        return u && u.status === 'battlefield' ? u.models.filter((m) => m.alive) : [];
      });
      if (points.length === 0) return;
      userMoved.current = true;
      const framed = frameView(v, points, vp, FOCUS_SCALE);
      const scale = clampScale(framed.scale, vp, TABLE, rot);
      // Clamping can only zoom in (to the minimum scale); re-centre on the same middle point.
      setView(scale === framed.scale ? framed : frameView(v, points, vp, scale, 0), true);
    } else {
      const unit = useGame.getState().session.state.units[camera.unit];
      if (!unit || unit.status !== 'battlefield') return;
      const c = unitCentre(unit);
      if (camera.onlyIfHidden && isVisible(v, c, vp)) return;
      userMoved.current = true;
      const scale = camera.zoom
        ? clampScale(Math.max(v.scale, FOCUS_SCALE), vp, TABLE, rot)
        : v.scale;
      setView(centreOn(v, c, vp, scale), true);
    }
    // setView only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, rot]);

  return (
    <svg
      ref={svgRef}
      className={`board ${draft ? 'placing' : ''}`}
      data-testid="board"
      data-rot={rot}
      role="application"
      aria-label="Battlefield"
    >
      <Defs />
      <g ref={gRef}>
        <TableLayer human={human} />
        <ObjectivesLayer />
        <RangeLayer />
        <UnitsLayer />
        <GhostLayer rot={rot} />
        <LabelsLayer rot={rot} />
      </g>
    </svg>
  );
}
