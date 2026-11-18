import { type GameState, type UnitId, type UnitState } from './types.js';

/** A deep copy of the state. `apply` clones once and then edits the copy freely. */
export function cloneState(state: GameState): GameState {
  const units: Record<UnitId, UnitState> = {};
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    units[id] = {
      ...u,
      models: u.models.map((m) => ({ ...m })),
      ...(u.abilitiesUsed ? { abilitiesUsed: [...u.abilitiesUsed] } : {}),
    };
  }
  const player = (p: GameState['players'][number]): GameState['players'][number] => ({
    ...p,
    vpByRound: [...p.vpByRound],
    ...(p.commandsUsed ? { commandsUsed: [...p.commandsUsed] } : {}),
    ...(p.spellsAttempted ? { spellsAttempted: [...p.spellsAttempted] } : {}),
    ...(p.furyUsedThisTurn ? { furyUsedThisTurn: [...p.furyUsedThisTurn] } : {}),
    ...(p.tacticProgress ? { tacticProgress: { ...p.tacticProgress } } : {}),
  });
  return {
    ...state,
    players: [player(state.players[0]), player(state.players[1])],
    units,
    unitOrder: [...state.unitOrder],
    objectives: state.objectives.map((o) => ({ ...o })),
    stack: state.stack.map((f) => ({ ...f })),
    ...(state.effects
      ? {
          effects: state.effects.map((e) => ({
            ...e,
            ...(e.data ? { data: { ...e.data } } : {}),
          })),
        }
      : {}),
    ...(state.banishedThisTurn ? { banishedThisTurn: [...state.banishedThisTurn] } : {}),
    ...(state.reactionsOffered ? { reactionsOffered: [...state.reactionsOffered] } : {}),
    ...(state.overgrownTerrain ? { overgrownTerrain: [...state.overgrownTerrain] } : {}),
    ...(state.overgrown
      ? { overgrown: [[...state.overgrown[0]], [...state.overgrown[1]]] as [string[], string[]] }
      : {}),
    ...(state.usedPlacesOfPower ? { usedPlacesOfPower: [...state.usedPlacesOfPower] } : {}),
    ...(state.placeOfPowerUsedBy ? { placeOfPowerUsedBy: [...state.placeOfPowerUsedBy] } : {}),
    ...(state.turnStartObjectives ? { turnStartObjectives: { ...state.turnStartObjectives } } : {}),
    ...(state.turnStartInCombat ? { turnStartInCombat: [...state.turnStartInCombat] } : {}),
    ...(state.destroyedByChargeCombat
      ? { destroyedByChargeCombat: [...state.destroyedByChargeCombat] }
      : {}),
    ...(state.unitsDestroyedThisTurn
      ? { unitsDestroyedThisTurn: [...state.unitsDestroyedThisTurn] }
      : {}),
    ...(state.damagedInPhases
      ? {
          damagedInPhases: Object.fromEntries(
            Object.entries(state.damagedInPhases).map(([k, v]) => [k, [...v]]),
          ),
        }
      : {}),
    ...(state.pendingMortal ? { pendingMortal: [...state.pendingMortal] } : {}),
    ...(state.alarielleSeason ? { alarielleSeason: { ...state.alarielleSeason } } : {}),
  };
}
