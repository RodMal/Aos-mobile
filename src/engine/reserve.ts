/**
 * Reserve and ambush (task M4j): a Hunters of Huanchi unit uses Hidden Hunters instead of being
 * deployed and waits in reserve in ambush; Chameleon Ambush sets it up in its movement phase.
 * Core 24.0 and 24.1 (see docs/RULES-DECISIONS.md I109); printed text is in
 * data/factions/seraphon.json.
 */
import { abilitiesOf } from './abilities/effects.js';
import { CHAMELEON_AMBUSH_ID, HIDDEN_HUNTERS_ID } from './abilities/seraphon.js';
import { illegal, type Ctx } from './ctx.js';
import { destroyUnit } from './damage.js';
import { CHAMELEON_GAP } from './relocate.js';
import { isFactionTerrainUnit } from './query.js';
import type {
  Action,
  Frame,
  GameState,
  UnitId,
  PlayerId,
  Scenario,
  UnitOption,
  UnitState,
} from './types.js';

/** Core 24.1: at the start of this battle round, units still in reserve in ambush are destroyed. */
export const AMBUSH_DESTROYED_ROUND = 4;

const has = (scenario: Scenario, unit: UnitState, id: string): boolean =>
  abilitiesOf(scenario, unit).some((a) => a.id === id);

/** Hidden Hunters: offered while the unit is the next one to be deployed ("has not been deployed"). */
export function canHiddenHunters(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  const top = state.stack[state.stack.length - 1];
  return (
    top?.t === 'place' &&
    top.reason === 'deploy' &&
    top.unit === unit.id &&
    unit.status === 'reserve' &&
    !unit.inAmbush &&
    !isFactionTerrainUnit(scenario, unit) &&
    has(scenario, unit, HIDDEN_HUNTERS_ID)
  );
}

/** Chameleon Ambush: the unit is in ambush, in its player's own movement phase. */
export function canChameleon(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return (
    state.phase === 'movement' &&
    state.active === unit.owner &&
    state.stack.length === 0 &&
    unit.status === 'reserve' &&
    unit.inAmbush === true &&
    has(scenario, unit, CHAMELEON_AMBUSH_ID)
  );
}

export function chameleonOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  return canChameleon(scenario, state, unit)
    ? [
        {
          t: 'ability',
          abilityId: CHAMELEON_AMBUSH_ID,
          name: 'Chameleon Ambush',
          kind: 'activated',
          targets: [],
        },
      ]
    : [];
}

/** The units of `player` waiting in ambush. */
export function ambushUnits(state: GameState, player: PlayerId): UnitState[] {
  return state.unitOrder
    .map((id) => state.units[id]!)
    .filter((u) => u.owner === player && u.status === 'reserve' && u.inAmbush === true);
}

/** Chameleon Ambush: the unit is set up anywhere more than 9" from all enemy units (a `place` follows). */
export function chameleonAmbush(ctx: Ctx, action: Extract<Action, { t: 'ability' }>): void {
  const unit = ctx.s.units[action.unit];
  if (!unit || !canChameleon(ctx.scenario, ctx.s, unit)) {
    illegal('That unit cannot use Chameleon Ambush now.');
  }
  ctx.s.stack.push(chameleonFrame(unit.id));
}

/** The `place` frame of a Chameleon Ambush set-up. */
export function chameleonFrame(unit: UnitId): Extract<Frame, { t: 'place' }> {
  return {
    t: 'place',
    unit,
    reason: 'relocate',
    allowance: 0,
    dice: [],
    minEnemyGap: CHAMELEON_GAP,
    relocate: { kind: 'chameleon' },
  };
}

/** Core 24.1: at the start of the fourth battle round, units still in reserve in ambush are destroyed. */
export function destroyAmbushUnits(ctx: Ctx): void {
  for (const id of ctx.s.unitOrder) {
    const unit = ctx.s.units[id]!;
    if (unit.status !== 'reserve' || !unit.inAmbush) continue;
    ctx.events.push({
      t: 'note',
      text: `${unit.name} is destroyed: it was still in reserve at the start of round ${AMBUSH_DESTROYED_ROUND}.`,
    });
    destroyUnit(ctx, unit, 'Still in reserve');
  }
}
