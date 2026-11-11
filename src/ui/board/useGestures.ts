/**
 * Pointer gestures on the board: tap, one-finger drag (pan or drag a ghost), two-finger
 * pinch-zoom and pan, wheel zoom. The view lives in a ref and is applied without React
 * re-renders; React only hears about taps and ghost drags.
 */
import { useEffect, type RefObject } from 'react';
import {
  clampView,
  panBy,
  screenDeltaToTable,
  zoomAbout,
  type Pt,
  type TableSize,
  type View,
  type Viewport,
} from './view.js';

export type DragKind = 'pan' | 'ghost' | 'model';

export interface GestureHandlers {
  /** What a one-finger drag starting at this screen point does. */
  dragKindAt(p: Pt): DragKind;
  onTap(p: Pt): void;
  /** A ghost or model drag moved by (dx, dy) inches in table space. */
  onDrag(kind: Exclude<DragKind, 'pan'>, dx: number, dy: number): void;
  onDragEnd(): void;
  /** Pointer touched down on the board, so any in-flight camera animation should stop. */
  onPointerDown?(): void;
  /** The user panned or zoomed the view manually. */
  onUserView(): void;
}

export interface GestureRefs {
  view: RefObject<View | null>;
  viewport: RefObject<Viewport | null>;
  table: TableSize;
  /** Re-applies the transform on the next animation frame. */
  schedule(): void;
  handlers: RefObject<GestureHandlers | null>;
}

const TAP_SLOP_PX = 10;
const TAP_MS = 600;

type Mode =
  | { t: 'idle' }
  | { t: 'pending'; kind: DragKind; start: Pt; at: number; last: Pt }
  | { t: 'pan'; last: Pt }
  | { t: 'drag'; kind: Exclude<DragKind, 'pan'>; last: Pt }
  | { t: 'pinch'; mid: Pt; dist: number }
  | { t: 'done' };

export function useGestures(target: RefObject<SVGSVGElement | null>, refs: GestureRefs): void {
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const pointers = new Map<number, Pt>();
    let mode: Mode = { t: 'idle' };

    const local = (e: PointerEvent | WheelEvent): Pt => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const setView = (v: View) => {
      const vp = refs.viewport.current;
      refs.view.current = vp ? clampView(v, vp, refs.table) : v;
      refs.schedule();
    };
    const two = (): [Pt, Pt] => {
      const [a, b] = [...pointers.values()];
      return [a!, b!];
    };
    const pinchStart = (): Mode => {
      const [a, b] = two();
      return {
        t: 'pinch',
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      };
    };
    const endDrag = () => {
      if (mode.t === 'drag') refs.handlers.current?.onDragEnd();
    };
    // The cursor shows a closed hand while the board is being dragged (mouse only matters).
    const grabbing = (on: boolean) => el.classList.toggle('grabbing', on);

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture?.(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      refs.handlers.current?.onPointerDown?.();
      if (pointers.size === 1) {
        const kind = refs.handlers.current?.dragKindAt(p) ?? 'pan';
        mode = { t: 'pending', kind, start: p, at: e.timeStamp, last: p };
      } else if (pointers.size === 2) {
        endDrag();
        refs.handlers.current?.onUserView();
        mode = pinchStart();
      }
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const v = refs.view.current;
      if (!v) return;
      switch (mode.t) {
        case 'pending': {
          if (Math.hypot(p.x - mode.start.x, p.y - mode.start.y) < TAP_SLOP_PX) return;
          const last = mode.start;
          grabbing(true);
          if (mode.kind === 'pan') {
            refs.handlers.current?.onUserView();
            mode = { t: 'pan', last };
          } else {
            mode = { t: 'drag', kind: mode.kind, last };
          }
          move(e);
          return;
        }
        case 'pan':
          setView(panBy(v, p.x - mode.last.x, p.y - mode.last.y));
          mode = { t: 'pan', last: p };
          return;
        case 'drag': {
          const d = screenDeltaToTable(v, { x: p.x - mode.last.x, y: p.y - mode.last.y });
          refs.handlers.current?.onDrag(mode.kind, d.x, d.y);
          mode = { ...mode, last: p };
          return;
        }
        case 'pinch': {
          if (pointers.size < 2) return;
          const next = pinchStart() as Extract<Mode, { t: 'pinch' }>;
          const vp = refs.viewport.current;
          if (!vp) return;
          let nv = zoomAbout(v, next.dist / mode.dist, next.mid, vp, refs.table);
          nv = panBy(nv, next.mid.x - mode.mid.x, next.mid.y - mode.mid.y);
          setView(nv);
          mode = next;
          return;
        }
        default:
          return;
      }
    };

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (mode.t === 'pending' && e.type === 'pointerup' && e.timeStamp - mode.at < TAP_MS) {
        refs.handlers.current?.onTap(mode.start);
      }
      endDrag();
      if (pointers.size === 0) grabbing(false);
      if (pointers.size === 0) mode = { t: 'idle' };
      else if (pointers.size === 1) mode = { t: 'done' };
      else if (pointers.size >= 2) mode = pinchStart();
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = refs.view.current;
      const vp = refs.viewport.current;
      if (!v || !vp) return;
      refs.handlers.current?.onUserView();
      setView(zoomAbout(v, Math.exp(-e.deltaY * 0.0015), local(e), vp, refs.table));
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [target, refs]);
}
