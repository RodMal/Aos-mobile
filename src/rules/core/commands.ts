/**
 * The command table and the restrictions every command shares (GHB 2026-27, Commands
 * 2026-27, 1.2): "Each unit can only use 1 command in each phase, each command can only be
 * used 1 time by each army in each phase, and you must spend a number of command points
 * equal to the command point cost to use a command."
 *
 * Ported from aos-webapp `rules/commands.ts`. Only the four commands of milestone M2 are
 * playable; the rest are listed so the UI can name them, with `implemented: false`.
 */
import type { CommandId, GameState, Phase, PlayerId, UnitState } from '../../engine/types.js';

export type CommandTurn = 'your' | 'enemy' | 'any';

export interface CommandDefinition {
  id: CommandId;
  name: string;
  cost: number;
  phases: Phase[];
  turn: CommandTurn;
  implemented: boolean;
  effect: string;
}

export const COMMANDS: Record<CommandId, CommandDefinition> = {
  rally: {
    id: 'rally',
    name: 'Rally',
    cost: 1,
    phases: ['hero'],
    turn: 'your',
    implemented: true,
    effect:
      'A unit not in combat makes 6 rally rolls; each 4+ is a rally point. Heal 1 per point, or return a slain model for points equal to its Health.',
  },
  atTheDouble: {
    id: 'atTheDouble',
    name: 'At the Double',
    cost: 1,
    phases: ['movement'],
    turn: 'your',
    implemented: true,
    effect: 'A unit that runs does not make a run roll: it counts as 6.',
  },
  allOutAttack: {
    id: 'allOutAttack',
    name: 'All-out Attack',
    cost: 1,
    phases: ['shooting', 'combat'],
    turn: 'any',
    implemented: true,
    effect: 'Add 1 to hit rolls for that attack, including Companion weapons.',
  },
  allOutDefence: {
    id: 'allOutDefence',
    name: 'All-out Defence',
    cost: 1,
    phases: ['shooting', 'combat'],
    turn: 'any',
    implemented: true,
    effect: 'Reaction when a unit is targeted: add 1 to its save rolls for those attacks.',
  },
  forwardToVictory: {
    id: 'forwardToVictory',
    name: 'Forward to Victory',
    cost: 1,
    phases: ['charge'],
    turn: 'your',
    implemented: false,
    effect: 'Re-roll the charge roll.',
  },
  redeploy: {
    id: 'redeploy',
    name: 'Redeploy',
    cost: 1,
    phases: ['movement'],
    turn: 'enemy',
    implemented: false,
    effect: 'A unit not in combat moves up to D6".',
  },
  counterCharge: {
    id: 'counterCharge',
    name: 'Counter-charge',
    cost: 2,
    phases: ['charge'],
    turn: 'enemy',
    implemented: false,
    effect: 'A unit not in combat charges in the enemy charge phase.',
  },
  coveringFire: {
    id: 'coveringFire',
    name: 'Covering Fire',
    cost: 1,
    phases: ['shooting', 'charge'],
    turn: 'enemy',
    implemented: false,
    effect: 'A unit shoots the closest enemy unit with -1 to hit.',
  },
  magicalIntervention: {
    id: 'magicalIntervention',
    name: 'Magical Intervention',
    cost: 1,
    phases: ['hero'],
    turn: 'enemy',
    implemented: false,
    effect: 'A Wizard or Priest casts or chants in the enemy hero phase at -1.',
  },
  powerThrough: {
    id: 'powerThrough',
    name: 'Power Through',
    cost: 1,
    phases: ['end'],
    turn: 'any',
    implemented: false,
    effect: 'A unit that charged inflicts D3 mortal damage on a weaker enemy and moves.',
  },
};

/**
 * Why `player` cannot use `command` with `unit` right now, or null if they can. Checks the
 * timing (phase and whose turn), the cost and the once-per-phase limits; command-specific
 * conditions (Rally's "not in combat") are checked by the caller.
 */
export function commandBlocker(
  state: GameState,
  player: PlayerId,
  command: CommandId,
  unit: UnitState,
): string | null {
  const def = COMMANDS[command];
  if (!def.implemented) return `${def.name} is not available yet.`;
  if (!def.phases.includes(state.phase)) return `${def.name} cannot be used in this phase.`;
  if (def.turn === 'your' && state.active !== player) return `${def.name} is used in your turn.`;
  if (def.turn === 'enemy' && state.active === player) {
    return `${def.name} is used in the enemy turn.`;
  }
  if (unit.owner !== player || unit.status !== 'battlefield') {
    return `${unit.name} cannot use commands.`;
  }
  if (state.players[player].cp < def.cost) return `${def.name} costs ${def.cost} CP.`;
  if ((state.players[player].commandsUsed ?? []).includes(command)) {
    return `${def.name} has already been used this phase.`;
  }
  if (unit.commandUsed) return `${unit.name} has already used a command this phase.`;
  return null;
}

/** Spends the cost and records the use against the army and the unit. Mutates `state`. */
export function payCommand(
  state: GameState,
  player: PlayerId,
  command: CommandId,
  unit: UnitState,
) {
  const p = state.players[player];
  p.cp -= COMMANDS[command].cost;
  p.commandsUsed = [...(p.commandsUsed ?? []), command];
  unit.commandUsed = command;
}

/** Clears the once-per-phase records. Mutates `state`. */
export function clearPhaseCommands(state: GameState): void {
  for (const p of state.players) p.commandsUsed = [];
  for (const id of state.unitOrder) state.units[id]!.commandUsed = null;
}
