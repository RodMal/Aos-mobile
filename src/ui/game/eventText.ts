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
  /** How much the line deserves the toast: higher wins (default 1 for major lines). */
  weight?: number;
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
  summon: 'is summoned',
  powerThrough: 'powers through',
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
        weight: 2,
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
      const detail = [`Source: ${ev.source}`];
      if (ev.destroyed) return { text: `${name} destroyed`, kind: 'major', weight: 3, detail };
      if (ev.slain > 0)
        return { text: `${name} lost ${plural(ev.slain, 'model')}`, kind: 'major', detail };
      return { text: `${name} took ${ev.amount} damage`, kind: 'major', weight: 0.5, detail };
    }
    case 'command':
      return {
        text: `${ctx.playerName(ev.player)} used ${COMMAND_NAMES[ev.command]} on ${ctx.unitName(ev.unit)}`,
        kind: 'major',
        player: ev.player,
      };
    case 'cast':
      if (ev.miscast) {
        return {
          text: `${ctx.unitName(ev.unit)} miscasts ${ev.ability} (${ev.dice[0]}+${ev.dice[1]}=${ev.total}).`,
          kind: 'major',
        };
      }
      return {
        text: `${ctx.unitName(ev.unit)} ${ev.success ? 'casts' : 'fails to cast'} ${ev.ability} (${ev.dice[0]}+${ev.dice[1]}=${ev.total} vs ${ev.targetValue}+).`,
        kind: 'major',
      };
    case 'unbind':
      return {
        text: `${ctx.unitName(ev.unit)} ${ev.unbound ? 'unbinds' : 'fails to unbind'} ${ev.ability} (${ev.dice[0]}+${ev.dice[1]}=${ev.total} vs ${ev.castTotal}).`,
        kind: 'major',
      };
    case 'chant':
      return {
        text: `${ctx.unitName(ev.unit)} chants ${ev.ability} (rolled ${ev.die}, total ${ev.total} vs ${ev.targetValue}+)${ev.answered ? ' — answered!' : ` (${ev.ritualPoints} ritual pts)`}.`,
        kind: 'major',
      };
    case 'banish':
      return {
        text: `${ctx.unitName(ev.unit)} ${ev.banished ? 'banishes' : 'fails to banish'} ${ctx.unitName(ev.target)} (${ev.dice[0]}+${ev.dice[1]}=${ev.total} vs ${ev.targetValue}+).`,
        kind: 'major',
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
        weight: 4,
      };
    case 'note':
      return { text: ev.text, kind: 'minor' };
  }
}

/** The line worth a toast from one batch of events: the last major one, else the last one. */
export function toastLine(lines: readonly LogLine[]): LogLine | null {
  let best: LogLine | null = null;
  let bestWeight = -Infinity;
  for (const line of lines) {
    const w = line.weight ?? (line.kind === 'minor' ? 0 : 1);
    if (w >= bestWeight) {
      best = line;
      bestWeight = w;
    }
  }
  return best;
}

/** A reaction trigger such as "shoot:1:5" in words. */
export function reactionText(trigger: string, ctx: LogContext): string {
  if (trigger.startsWith('spell:')) {
    const [, casterId, abilityName] = trigger.split(':');
    return `${casterId ? ctx.unitName(casterId) : 'Enemy Wizard'} cast ${abilityName ?? 'a spell'}. Unbind?`;
  }
  if (trigger.startsWith('move:')) {
    const [, moverId] = trigger.split(':');
    return `${moverId ? ctx.unitName(moverId) : 'Enemy unit'} finished a move nearby.`;
  }
  if (trigger.startsWith('phase:')) {
    return 'End of phase reaction opportunity.';
  }
  const m = /^(shoot|fight|charge):(.+)$/.exec(trigger);
  if (!m) return trigger;
  const verb = {
    shoot: 'is about to shoot',
    fight: 'is about to fight',
    charge: 'is charging',
  }[m[1] as 'shoot' | 'fight' | 'charge'];
  return `${ctx.unitName(m[2]!)} ${verb}.`;
}

/** Display name of an objective id such as "golden-lions-1". */
export function objectiveLabel(id: string): string {
  return id
    .split('-')
    .map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}
