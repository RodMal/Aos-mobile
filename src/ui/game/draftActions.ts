/** Edits to the placement draft, checked against the engine on each change. Browser only. */
import type { GameState, UnitState } from '../../engine/index.js';
import { engine } from './engine.js';
import { useGame } from './instance.js';
import { startDraft, type PlacementDraft } from './placementEdit.js';
import { useUi, type DraftState } from './uiStore.js';

export function editDraft(
  fn: (d: DraftState, unit: UnitState, state: GameState) => PlacementDraft,
): void {
  const ui = useUi.getState();
  const d = ui.draft;
  if (!d) return;
  const state = useGame.getState().session.state;
  const unit = state.units[d.unit];
  if (!unit) return;
  const next = fn(d, unit, state);
  ui.setDraft({ ...d, ...next, violations: engine.checkPlacement(state, next.placement) });
}

/** Starts a fresh draft for the unit being placed. */
export function beginDraft(state: GameState, unitId: string): void {
  const unit = state.units[unitId];
  if (!unit) return;
  const d = startDraft(state, unit);
  useUi.getState().setDraft({
    ...d,
    violations: engine.checkPlacement(state, d.placement),
    adjust: false,
    activeModel: null,
  });
}
