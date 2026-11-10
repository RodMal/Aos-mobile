/** View state that is not part of the game: selection, drawers, drafts and the camera. */
import { create } from 'zustand';
import type { AttackMode, UnitId, Violation, WeaponTargets } from '../../engine/index.js';
import type { AttackPlan } from './attackPlan.js';
import type { PlacementDraft } from './placementEdit.js';

export type Drawer = 'roster' | 'log' | 'army' | 'menu' | null;

export type CameraRequest =
  | { kind: 'unit'; unit: UnitId; zoom: boolean; onlyIfHidden: boolean }
  | { kind: 'zoom'; factor: number }
  | { kind: 'fit' };

export interface DraftState extends PlacementDraft {
  violations: Violation[];
  /** Per-model adjustment mode. */
  adjust: boolean;
  /** The model being adjusted. */
  activeModel: number | null;
}

export interface AttackState {
  unit: UnitId;
  mode: AttackMode;
  options: WeaponTargets[];
  plan: AttackPlan;
  allOutAttack: boolean;
}

export interface ChooserState {
  units: UnitId[];
  /** Screen position of the tap, relative to the board. */
  x: number;
  y: number;
}

interface UiStore {
  selected: UnitId | null;
  sheetExpanded: boolean;
  drawer: Drawer;
  chooser: ChooserState | null;
  draft: DraftState | null;
  attack: AttackState | null;
  confirm: { text: string; action: () => void; ok: string } | null;
  camera: (CameraRequest & { nonce: number }) | null;
  /** Height of the bottom sheet in px, so the board can keep the table above it. */
  sheetHeight: number;
  /**
   * The zoom (px per inch) rounded down to a coarse step. Changes only when the zoom crosses
   * a step, so label decluttering can re-render rarely instead of on every pinch frame.
   */
  zoomBucket: number;
  select(id: UnitId | null): void;
  setSheetExpanded(v: boolean): void;
  openDrawer(d: Drawer): void;
  setChooser(c: ChooserState | null): void;
  setDraft(d: DraftState | null): void;
  setAttack(a: AttackState | null): void;
  ask(text: string, ok: string, action: () => void): void;
  closeConfirm(): void;
  moveCamera(req: CameraRequest): void;
  setSheetHeight(h: number): void;
  reset(): void;
}

let nonce = 0;

export const useUi = create<UiStore>((set) => ({
  selected: null,
  sheetExpanded: false,
  drawer: null,
  chooser: null,
  draft: null,
  attack: null,
  confirm: null,
  camera: null,
  sheetHeight: 0,
  zoomBucket: 10,
  select: (id) => set({ selected: id, chooser: null, sheetExpanded: false }),
  setSheetExpanded: (v) => set({ sheetExpanded: v }),
  openDrawer: (d) => set({ drawer: d, chooser: null }),
  setChooser: (c) => set({ chooser: c }),
  setDraft: (d) => set({ draft: d }),
  setAttack: (a) => set({ attack: a }),
  ask: (text, ok, action) => set({ confirm: { text, ok, action } }),
  closeConfirm: () => set({ confirm: null }),
  moveCamera: (req) => set({ camera: { ...req, nonce: ++nonce } }),
  setSheetHeight: (h) => set({ sheetHeight: h }),
  reset: () =>
    set({
      selected: null,
      sheetExpanded: false,
      drawer: null,
      chooser: null,
      draft: null,
      attack: null,
      confirm: null,
    }),
}));
