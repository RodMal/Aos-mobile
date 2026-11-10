/** What the buttons do. Browser only: reads and writes the stores. */
import { unitsOf, type UnitId, type UnitOption } from '../../engine/index.js';
import { diceText } from '../../data/profile.js';
import { emptyPlan, assignAll, targetSummary, toAllocations } from './attackPlan.js';
import { engine, profileFor } from './engine.js';
import { COMMAND_NAMES, PHASE_NAMES, inches } from './eventText.js';
import { useGame } from './instance.js';
import { useUi } from './uiStore.js';

const game = () => useGame.getState();

export function dispatch(...args: Parameters<ReturnType<typeof game>['dispatch']>): boolean {
  return game().dispatch(...args);
}

/** Ends the human's phase, asking first when nothing moved in a movement phase. */
export function endPhase(): void {
  const { session } = game();
  const s = session.state;
  const d = engine.decision(s);
  if (!d || d.kind !== 'main' || d.player !== session.humanPlayer) return;
  const go = () => {
    useUi.getState().select(null);
    dispatch({ t: 'pass' });
  };
  if (d.phase === 'movement' && unitsOf(s, session.humanPlayer).every((u) => u.moved === null)) {
    useUi
      .getState()
      .ask('No unit has moved this phase. End the movement phase anyway?', 'End phase', go);
    return;
  }
  go();
}

export function optionLabel(unitId: UnitId, o: UnitOption): string {
  const unit = game().session.state.units[unitId]!;
  const p = profileFor(unit);
  switch (o.t) {
    case 'move': {
      const base = p.moveDice ? diceText(p.moveDice) + '"' : inches(o.allowance);
      if (o.kind === 'run') return `Run ${base}+D6`;
      if (o.kind === 'retreat') return `Retreat ${base}`;
      return `Move ${base}`;
    }
    case 'shoot':
      return 'Shoot';
    case 'charge':
      return 'Charge 2D6';
    case 'fight':
      return 'Fight';
    case 'command':
      return `${COMMAND_NAMES[o.command]} · ${o.cost} CP`;
  }
}

export function runOption(unitId: UnitId, o: UnitOption): void {
  switch (o.t) {
    case 'move':
      dispatch({ t: 'move', unit: unitId, kind: o.kind });
      return;
    case 'shoot':
      startAttack(unitId, 'shoot');
      return;
    case 'charge':
      dispatch({ t: 'charge', unit: unitId });
      return;
    case 'fight':
      dispatch({ t: 'fight', unit: unitId });
      return;
    case 'command':
      dispatch({ t: 'command', command: o.command, unit: unitId });
      return;
  }
}

/** Opens the weapon-allocation panel for a unit about to shoot or fight. */
export function startAttack(unitId: UnitId, mode: 'shoot' | 'fight'): void {
  const state = game().session.state;
  const options = engine.targetOptions(state, unitId, mode);
  if (mode === 'shoot' && options.every((o) => o.targets.length === 0)) {
    game().showToast('No enemy unit is in range of this unit’s weapons.', 'error');
    return;
  }
  let plan = emptyPlan(options);
  const targets = [...targetSummary(options).keys()];
  if (targets.length === 1) plan = assignAll(plan, options, targets[0]!);
  useUi.getState().setAttack({ unit: unitId, mode, options, plan, allOutAttack: false });
}

/** Rolls the attacks in the allocation panel. */
export function rollAttack(): void {
  const attack = useUi.getState().attack;
  if (!attack) return;
  const allocations = toAllocations(attack.plan);
  const ok =
    attack.mode === 'shoot'
      ? dispatch({ t: 'shoot', unit: attack.unit, allocations, allOutAttack: attack.allOutAttack })
      : dispatch({ t: 'targets', allocations, allOutAttack: attack.allOutAttack });
  if (ok) useUi.getState().setAttack(null);
}

export function phaseName(phase: string): string {
  return PHASE_NAMES[phase] ?? phase;
}
