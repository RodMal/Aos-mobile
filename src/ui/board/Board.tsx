/** The battlefield: one SVG, one view transform, touch gestures and the camera. */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
  clampScale,
  clampView,
  fitView,
  isVisible,
  lerpView,
  rotationFor,
  screenToTable,
  svgTransform,
  visibleCentre,
  zoomAbout,
  type Pt,
  type View,
  type Viewport,
} from './view.js';

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
  const rot = rotationFor(human);
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
        const result = pick(hitTest(units, at, slop));
        if (result.t === 'one') ui.select(result.key);
        else if (result.t === 'choose') ui.setChooser({ units: result.keys, x: p.x, y: p.y });
        else ui.select(null);
      },
    };
  }, []);

  useGestures(svgRef, refs);

  // Size: fit on first layout and keep the view valid as the viewport changes.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
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
      className="board"
      data-testid="board"
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
