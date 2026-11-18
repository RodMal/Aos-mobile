import { battleplanRules } from '../rules/battleplans/index.js';
import { clearPhaseCommands } from '../rules/core/commands.js';
import { resolveControl } from '../rules/core/objectives.js';
import { priorityWinner, roundCommandPoints, seizes } from '../rules/core/round.js';
import { clearExpiredEffects } from './abilities/effects.js';
import { d6, illegal, type Ctx } from './ctx.js';
import { attackerOf, opponent } from './query.js';
import {
  evaluateEndOfTurnTactics,
  initBattleTactics,
  needsFugitive,
  fugitiveCandidates,
  recordTurnStartForTactics,
} from '../rules/core/battleTactics.js';
import { applySimmeringRage, initFury } from '../rules/core/fury.js';
import { placeOfPowerCandidate } from './terrain.js';
import { applyEverGrowing, resolveEndlessGrowth } from '../rules/factions/sylvaneth.js';
import {
  burgeoningPick,
  creepingDreadCandidates,
  creepingDreadMax,
  hasCreepingDread,
  seasonsUnit,
} from '../rules/factions/seasons.js';
import { PHASES, type PlayerId } from './types.js';

// ─── Turn sequence ──────────────────────────────────────────────────────────────

export function startTurn(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const id of s.unitOrder) {
    const u = s.units[id]!;
    u.moved = null;
    u.charged = false;
    u.shot = false;
    u.fought = false;
    u.declinedTerrainFight = false;
    u.chargeDeclared = false;
    u.allOutAttack = false;
    u.castsUsed = 0;
    u.miscast = false;
    u.abilitiesUsed = [];
    u.setUpThisTurn = false;
    u.magicalIntervention = false;
  }
  for (const p of s.players) {
    p.spellsAttempted = [];
    p.furyUsedThisTurn = [];
  }
  s.usedPlacesOfPower = [];
  s.placeOfPowerUsedBy = [];
  recordTurnStartForTactics(scenario, s);
  s.banishedThisTurn = [];
  s.reactionsOffered = [];
  s.fightTier = null;
  clearExpiredEffects(s, 'startOfNextTurn', s.active);
  clearPhaseCommands(s);
  s.phase = 'hero';
  s.fightPicker = null;
  s.creepingDread = null;
  ctx.events.push({ t: 'turnStart', player: s.active, round: s.round });
  ctx.events.push({ t: 'phaseStart', phase: s.phase, player: s.active });
  offerCreepingDread(ctx);
  offerPlacesOfPower(ctx);
}

/** Start of any turn: a Sylvaneth player with enemy units in the overgrowth may use Creeping Dread. */
export function offerCreepingDread(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const player of [0, 1] as PlayerId[]) {
    if (!hasCreepingDread(scenario, player)) continue;
    const units = creepingDreadCandidates(scenario, s, player);
    if (units.length === 0) continue;
    s.stack.push({
      t: 'creepingDread',
      player,
      units,
      max: creepingDreadMax(scenario, s, player),
    });
  }
}

export function chooseCreepingDread(ctx: Ctx, value: string): void {
  const { s } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (frame?.t !== 'creepingDread') illegal('There is no Creeping Dread to use.');
  const picked = [
    ...new Set(
      value
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  if (picked.length === 0 || picked.length > frame.max) {
    illegal(`Pick 1 to ${frame.max} enemy units within the creeping overgrowth.`);
  }
  if (picked.some((id) => !frame.units.includes(id))) {
    illegal('Creeping Dread targets an enemy unit within the creeping overgrowth.');
  }
  s.stack.pop();
  s.creepingDread = { player: frame.player, targets: picked, spent: [] };
  ctx.events.push({
    t: 'note',
    text: `Creeping Dread: ${picked.map((id) => s.units[id]!.name).join(', ')}; the first command for each this turn costs 1 more CP unless it is wholly within 12" of a Hero.`,
  });
}

/**
 * Start of turn: each player with a hero within 3" of a Place of Power may activate it, the
 * active player first (owner's ruling, 2026-11-11).
 */
export function offerPlacesOfPower(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const player of [opponent(s.active), s.active]) {
    const c = placeOfPowerCandidate(scenario, s, player);
    if (c) s.stack.push({ t: 'placeOfPower', player, hero: c.hero.id, terrain: c.terrain.id });
  }
}

/** After priority: command points (with the underdog's extra point), then the first turn. */
export function beginRound(ctx: Ctx): void {
  const { s } = ctx;
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].cp = roundCommandPoints(s, p);
    ctx.events.push({ t: 'commandPoints', player: p, cp: s.players[p].cp });
  }
  s.turnIndex = 0;
  s.active = s.firstPlayer;
  startTurn(ctx);
}

export function startRound(ctx: Ctx): void {
  const { s, scenario } = ctx;
  ctx.events.push({ t: 'roundStart', round: s.round });
  s.seizedThisRound = null;
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].cp = 0;
    s.players[p].vpByRound.push(0);
  }
  if (s.round === 1) {
    initFury(s, attackerOf(scenario));
    initBattleTactics(scenario, s);
  }
  applySimmeringRage(s);
  // Seasons Of War ("You must use this ability", start of the battle round) comes first, so
  // The Burgeoning can shape this round's Ever Growing.
  const alarielle = seasonsUnit(scenario, s);
  if (alarielle && !s.alarielleSeason?.[s.round]) {
    s.stack.push({ t: 'alarielleSeason', player: alarielle.owner, unit: alarielle.id });
    return;
  }
  continueRound(ctx);
}

/** The rest of the start of the battle round: Ever Growing, then who takes the first turn. */
export function continueRound(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const text of applyEverGrowing(scenario, s, (w) =>
    burgeoningPick(scenario, s, w.owner, w.id),
  )) {
    ctx.events.push({ t: 'note', text });
  }
  if (s.round === 1) {
    roundOneFirstTurn(ctx);
    return;
  }
  const rolls: [number, number] = [d6(ctx), d6(ctx)];
  const winner = priorityWinner(rolls, s.firstPlayer);
  ctx.events.push({ t: 'priority', rolls, winner });
  s.stack.push({ t: 'priority', winner, rolls });
}

/**
 * Round 1, after every deployment ability and before the first turn is decided: pre-battle
 * picks (the Burning for Vengeance fugitive, attacker first), then the first turn.
 */
export function roundOneFirstTurn(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const p of [0, 1] as PlayerId[]) {
    if (needsFugitive(scenario, s, p)) {
      s.stack.push({ t: 'fugitive', player: p, units: fugitiveCandidates(scenario, s, p) });
      return;
    }
  }
  // Round 1 (owner's ruling, 2026-11-11): the player who finished deploying first chooses who
  // takes the first turn; in a quick-start game (no deployment) the attacker chooses.
  const chooser = s.deploymentFinishedFirst ?? attackerOf(scenario);
  s.stack.push({ t: 'priority', winner: chooser, rolls: [0, 0], reason: 'deployment' });
}

export function chooseFugitive(ctx: Ctx, value: string): void {
  const { s } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (frame?.t !== 'fugitive') illegal('There is no fugitive to pick.');
  if (!frame.units.includes(value)) {
    illegal('Pick an enemy Hero on the battlefield or in reserve to be the fugitive.');
  }
  s.stack.pop();
  s.players[frame.player].fugitiveUnit = value;
  ctx.events.push({
    t: 'note',
    text: `Player ${frame.player + 1} picks ${s.units[value]!.name} as the fugitive.`,
  });
  roundOneFirstTurn(ctx);
}

export function choosePriority(ctx: Ctx, value: string): void {
  const { s } = ctx;
  const frame = s.stack.pop();
  if (frame?.t !== 'priority') illegal('There is no priority choice to make.');
  if (value !== 'first' && value !== 'second') illegal('Choose "first" or "second".');
  const first = value === 'first' ? frame.winner : opponent(frame.winner);
  if (s.round > 1 && seizes(s, frame.winner, s.firstPlayer, first)) {
    s.seizedBy = first;
    s.seizedThisRound = first;
    ctx.events.push({ t: 'note', text: `Player ${first + 1} seizes the initiative.` });
  }
  s.firstPlayer = first;
  beginRound(ctx);
}

export function endGame(ctx: Ctx): void {
  const { s } = ctx;
  const [a, b] = [s.players[0].vp, s.players[1].vp];
  s.status = 'ended';
  s.winner = a === b ? 'draw' : a > b ? 0 : 1;
  ctx.events.push({ t: 'gameEnd', winner: s.winner, vp: [a, b] });
}

/** End of a turn: resolve objective control, then the player whose turn it was scores. */
export function endTurn(ctx: Ctx): void {
  const { s, scenario } = ctx;
  // Endless Growth is used at the end of any turn by each army that has it.
  resolveEndlessGrowth(ctx, s.active);
  resolveEndlessGrowth(ctx, opponent(s.active));
  clearExpiredEffects(s, 'turn');
  for (const change of resolveControl(scenario, s)) {
    s.objectives.find((o) => o.id === change.id)!.controller = change.controller;
    ctx.events.push({ t: 'objective', objective: change.id, controller: change.controller });
  }
  const player = s.active;
  for (const line of battleplanRules(scenario.battlefield.id).endOfTurnScore(s, player)) {
    s.players[player].vp += line.vp;
    s.players[player].vpByRound[s.round - 1] =
      (s.players[player].vpByRound[s.round - 1] ?? 0) + line.vp;
    ctx.events.push({ t: 'score', player, vp: line.vp, reason: line.reason });
  }
  const scoredTactics = evaluateEndOfTurnTactics(scenario, s, player);
  for (const st of scoredTactics) {
    s.players[player].vp += st.vp;
    s.players[player].vpByRound[s.round - 1] =
      (s.players[player].vpByRound[s.round - 1] ?? 0) + st.vp;
    const tier = st.tier.charAt(0).toUpperCase() + st.tier.slice(1);
    const reason =
      st.tacticName.toLowerCase() === st.tier.toLowerCase()
        ? `${st.cardName} — ${tier}`
        : `${st.cardName} — ${tier}: ${st.tacticName}`;
    ctx.events.push({ t: 'score', player, vp: st.vp, reason });
  }
}

export function advancePhase(ctx: Ctx): void {
  const { s, scenario } = ctx;
  clearPhaseCommands(s);
  clearExpiredEffects(s, 'phase');
  s.reactionsOffered = [];
  for (const id of s.unitOrder) {
    const u = s.units[id]!;
    u.miscast = false;
    u.magicalIntervention = false;
  }
  const next = PHASES[PHASES.indexOf(s.phase) + 1];
  if (next) {
    s.phase = next;
    s.fightPicker = next === 'combat' ? s.active : null;
    s.fightTier = null;
    ctx.events.push({ t: 'phaseStart', phase: next, player: s.active });
    return;
  }
  endTurn(ctx);
  if (s.turnIndex === 0) {
    s.turnIndex = 1;
    s.active = opponent(s.active);
    startTurn(ctx);
  } else if (s.round >= scenario.rounds) {
    endGame(ctx);
  } else {
    s.round += 1;
    startRound(ctx);
  }
}
