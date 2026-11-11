/** Edits to the placement draft, checked against the engine on each change. Browser only. */
import { chargePlacement, pileInPlacement } from '../../ai/placement.js';
import type { GameState, Placement, UnitState } from '../../engine/index.js';
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

/**
 * A legal position that brings the unit into contact for the pending charge or pile-in, or
 * null if there is none (or the pending placement is something else).
 */
import { npcDeployPlacement } from '../../engine/deployment.js';

export function engagePlacement(state: GameState, unitId: string): Placement | null {
  const d = engine.decision(state);
  if (!d || d.kind !== 'place' || d.unit !== unitId) return null;
  if (d.reason === 'charge') return chargePlacement(engine, state, unitId);
  if (d.reason === 'pileIn') return pileInPlacement(engine, state, unitId);
  if (d.reason === 'deploy')
    return npcDeployPlacement(engine.scenario, state, state.units[unitId]!);
  return null;
}

/**
 * Starts a fresh draft for the unit being placed. With `suggest`, a charge, pile-in or deploy starts
 * from a legal position, so the player can confirm at once or adjust it.
 */
export function beginDraft(state: GameState, unitId: string, suggest = false): void {
  const unit = state.units[unitId];
  if (!unit) return;
  const d = startDraft(state, unit);
  const dec = engine.decision(state);
  const isDeploy = dec?.kind === 'place' && dec.reason === 'deploy';
  const placement = (suggest || isDeploy ? engagePlacement(state, unitId) : null) ?? d.placement;
  useUi.getState().setDraft({
    ...d,
    placement,
    violations: engine.checkPlacement(state, placement),
    adjust: false,
    activeModel: null,
  });
}

/** Moves the draft to the engaged position for a charge or pile-in. */
export function engageDraft(): boolean {
  const ui = useUi.getState();
  const d = ui.draft;
  if (!d) return false;
  const state = useGame.getState().session.state;
  const placement = engagePlacement(state, d.unit);
  if (!placement) return false;
  ui.setDraft({ ...d, placement, violations: engine.checkPlacement(state, placement) });
  return true;
}
