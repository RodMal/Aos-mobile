import type { GameState, UnitState } from '../../engine/types.js';

/**
 * The word for a unit that is marked as having fought this combat phase (the engine flags it as
 * soon as it is picked): "fighting" while its pile-in and attacks are still being resolved,
 * "fought" once they are done, '' for a unit that has not been picked.
 */
export function fightWord(state: GameState, unit: UnitState): '' | 'fighting' | 'fought' {
  if (!unit.fought) return '';
  const busy = state.stack.some((f) => {
    switch (f.t) {
      case 'targets':
      case 'resolve':
        return f.unit === unit.id && f.mode === 'fight';
      case 'allocate':
        return f.attacker === unit.id && f.mode === 'fight';
      case 'place':
        return f.unit === unit.id && f.reason === 'pileIn';
      case 'reaction':
        return f.trigger === `fight:${unit.id}`;
      default:
        return false;
    }
  });
  return busy ? 'fighting' : 'fought';
}
