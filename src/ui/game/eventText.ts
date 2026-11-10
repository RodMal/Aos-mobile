/** Turns engine events into short log lines. Pure. */
import type { CommandId, GameEvent, PlaceReason, PlayerId } from '../../engine/index.js';

export interface LogContext {
  unitName(id: string): string;
  playerName(p: PlayerId): string;
  /** Weapon display name, given the attacking unit and the event's weapon field. */
  weaponName(attacker: string, weapon: string): string;
  objectiveName(id: string): string;
}

export type LogKind = 'major' | 'minor' | 'heading';

export interface LogLine {
  text: string;
  kind: LogKind;
  player?: PlayerId;
  /** Extra lines shown when the entry is expanded (attack dice). */
  detail?: string[];
}

export const PHASE_NAMES: Record<string, string> = {
  hero: 'Hero',
  movement: 'Movement',
  shooting: 'Shooting',
  charge: 'Charge',
  combat: 'Combat',
  end: 'End',
};

export const COMMAND_NAMES: Record<CommandId, string> = {
  rally: 'Rally',
  atTheDouble: 'At the Double',
  allOutAttack: 'All-out Attack',
  allOutDefence: 'All-out Defence',
  forwardToVictory: 'Forward to Victory',
  redeploy: 'Redeploy',
  counterCharge: 'Counter-charge',
  coveringFire: 'Covering Fire',
  magicalIntervention: 'Magical Intervention',
  powerThrough: 'Power Through',
};

export function inches(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}"`;
}

const MOVE_VERB: Record<PlaceReason, string> = {
  normal: 'moved',
  run: 'ran',
  retreat: 'retreated',
  charge: 'charged',
  pileIn: 'piled in',
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function diceList(d: readonly number[]): string {
  return d.length === 0 ? '–' : d.join(' ');
}

export function eventLine(ev: GameEvent, ctx: LogContext): LogLine | null {
  switch (ev.t) {
    case 'roundStart':
      return { text: `Battle round ${ev.round}`, kind: 'heading' };
    case 'priority':
      return {
        text: `Priority: ${ctx.playerName(0)} ${ev.rolls[0]}, ${ctx.playerName(1)} ${ev.rolls[1]}. ${ctx.playerName(ev.winner)} choose.`,
        kind: 'major',
        player: ev.winner,
      };
    case 'turnStart':
      return { text: `${ctx.playerName(ev.player)} turn`, kind: 'heading', player: ev.player };
    case 'phaseStart':
      return {
        text: `${PHASE_NAMES[ev.phase] ?? ev.phase} phase`,
        kind: 'minor',
        player: ev.player,
      };
    case 'commandPoints':
      return {
        text: `${ctx.playerName(ev.player)}: ${ev.cp} CP`,
        kind: 'minor',
        player: ev.player,
      };
    case 'moved': {
      const dice = ev.dice.length > 0 ? ` (rolled ${ev.dice.join('+')})` : '';
      return {
        text: `${ctx.unitName(ev.unit)} ${MOVE_VERB[ev.kind]} ${inches(ev.distance)}${dice}`,
        kind: 'major',
      };
    }
    case 'chargeRoll':
      return {
        text: `${ctx.unitName(ev.unit)} charge roll ${ev.dice[0]}+${ev.dice[1]} = ${ev.dice[0] + ev.dice[1]}: ${ev.success ? 'in range' : 'failed'}`,
        kind: 'major',
      };
    case 'attacks': {
      const saved = Math.max(0, ev.wounds - ev.unsaved);
      const parts = [
        plural(ev.attacks, 'attack'),
        plural(ev.hits, 'hit'),
        plural(ev.wounds, 'wound'),
        `${saved} saved`,
      ];
      if (ev.warded > 0) parts.push(`${ev.warded} warded`);
      if (ev.mortal > 0) parts.push(`${ev.mortal} mortal`);
      parts.push(`${ev.damage} damage`);
      return {
        text: `${ctx.weaponName(ev.attacker, ev.weapon)} → ${ctx.unitName(ev.target)}: ${parts.join(', ')}`,
        kind: 'major',
        detail: [
          `Attacker: ${ctx.unitName(ev.attacker)}${ev.crits > 0 ? ` · ${plural(ev.crits, 'critical hit')}` : ''}`,
          `Hit rolls: ${diceList(ev.dice.hit)}`,
          `Wound rolls: ${diceList(ev.dice.wound)}`,
          `Save rolls: ${diceList(ev.dice.save)}`,
          ...(ev.dice.ward.length > 0 ? [`Ward rolls: ${diceList(ev.dice.ward)}`] : []),
        ],
      };
    }
    case 'damage': {
      const name = ctx.unitName(ev.unit);
      if (ev.destroyed) return { text: `${name} destroyed`, kind: 'major' };
      if (ev.slain > 0)
        return { text: `${name} lost ${plural(ev.slain, 'model')} (${ev.source})`, kind: 'major' };
      return { text: `${name} took ${ev.amount} damage (${ev.source})`, kind: 'major' };
    }
    case 'command':
      return {
        text: `${ctx.playerName(ev.player)} used ${COMMAND_NAMES[ev.command]} on ${ctx.unitName(ev.unit)}`,
        kind: 'major',
        player: ev.player,
      };
    case 'roll':
      return {
        text: `${ev.label} roll: ${ev.dice.join(' + ')}`,
        kind: 'minor',
        player: ev.player,
      };
    case 'objective':
      return {
        text:
          ev.controller === null
            ? `${ctx.objectiveName(ev.objective)} is contested`
            : `${ctx.playerName(ev.controller)} control ${ctx.objectiveName(ev.objective)}`,
        kind: 'minor',
        ...(ev.controller === null ? {} : { player: ev.controller }),
      };
    case 'score':
      return {
        text: `${ctx.playerName(ev.player)} score ${ev.vp} VP: ${ev.reason}`,
        kind: 'major',
        player: ev.player,
      };
    case 'gameEnd':
      return {
        text:
          ev.winner === 'draw'
            ? `Game over: a draw, ${ev.vp[0]}–${ev.vp[1]}`
            : `Game over: ${ctx.playerName(ev.winner)} win ${ev.vp[0]}–${ev.vp[1]}`,
        kind: 'heading',
      };
    case 'note':
      return { text: ev.text, kind: 'minor' };
  }
}

/** The line worth a toast from one batch of events: the last major one, else the last one. */
export function toastLine(lines: readonly LogLine[]): LogLine | null {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.kind !== 'minor') return lines[i]!;
  return lines[lines.length - 1] ?? null;
}

/** Display name of an objective id such as "golden-lions-1". */
export function objectiveLabel(id: string): string {
  return id
    .split('-')
    .map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}
