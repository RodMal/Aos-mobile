import { battleplanRules } from '../rules/battleplans/index.js';
import { COMMANDS, clearPhaseCommands } from '../rules/core/commands.js';
import { resolveControl } from '../rules/core/objectives.js';
import { priorityWinner, roundCommandPoints, seizes } from '../rules/core/round.js';
import { clearExpiredEffects } from './abilities/effects.js';
import { d6, illegal, type Ctx } from './ctx.js';
import { attackerOf, opponent, unitsOf } from './query.js';
import { canFuryOfTheForest } from './eligibility.js';
import { canHuntmaster } from './relocate.js';
import { startOfCombatAbilities } from './anyPhase.js';
import {
  evaluateEndOfTurnTactics,
  initBattleTactics,
  needsFugitive,
  fugitiveCandidates,
  recordTurnStartForTactics,
} from '../rules/core/battleTactics.js';
import { applySimmeringRage, initFury } from '../rules/core/fury.js';
import { placeOfPowerCandidate } from './terrain.js';
import { applyEverGrowing } from '../rules/factions/sylvaneth.js';
import {
  burgeoningPick,
  creepingDreadCandidates,
  creepingDreadMax,
  hasCreepingDread,
  seasonsUnit,
} from '../rules/factions/seasons.js';
import { asterismOptions, nextAsterismFrame, recordAsterism } from '../rules/factions/seraphon.js';
import {
  DEAD_FOR_AGES_ID,
  hasWarscrollAbility,
  vengeanceCandidates,
} from '../rules/factions/kroak.js';
import { healUnit, destroyUnit } from './damage.js';
import { morbidDetonations } from './manifestations.js';
import { AMBUSH_DESTROYED_ROUND, destroyAmbushUnits } from './reserve.js';
import { PHASES, type Action, type PlayerId, type ReactionOption } from './types.js';

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
    delete u.chargeRerolled;
    delete u.oublietteTargets;
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
    p.usedOncePerTurn = [];
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
  if (s.round === AMBUSH_DESTROYED_ROUND) destroyAmbushUnits(ctx);
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
  finishRound(ctx);
}

/**
 * The end of the start of the battle round: Seraphon prophecies (The Great Plan in round 1,
 * Further the Great Plan later), then who takes the first turn.
 */
function finishRound(ctx: Ctx): void {
  const { s, scenario } = ctx;
  const asterism = nextAsterismFrame(scenario, s);
  if (asterism) {
    s.stack.push({ t: 'asterism', ...asterism });
    return;
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

/** The answer to The Great Plan or Further the Great Plan (see `Decision` kind `asterism`). */
export function chooseAsterism(ctx: Ctx, action: Action): void {
  const { s, scenario } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (frame?.t !== 'asterism') illegal('There is no Asterism to pick.');
  let key: string | null = null;
  let id: string | null = null;
  if (action.t === 'choose') {
    // The Great Plan: the Asterism. Further the Great Plan: `<key>,<Asterism to prophesy>`.
    const lists = asterismOptions(scenario, s, frame.player, frame.stage);
    const parts = action.value.split(',');
    if (frame.stage === 'great') {
      id = parts.length === 1 ? parts[0]! : null;
    } else {
      key = parts.length === 2 ? parts[0]! : null;
      id = parts.length === 2 ? parts[1]! : null;
      const keyOption = lists.keys.find((k) => k.id === key);
      if (!keyOption) illegal('Pick a prophesied Asterism you have not picked before as the key.');
      if (!keyOption.met)
        illegal(
          'That Asterism’s condition is not met: Further the Great Plan would have no effect.',
        );
    }
    if (!lists.options.some((o) => o.id === id)) {
      illegal('Pick an Asterism that is not prophesied yet.');
    }
  } else if (action.t !== 'pass') {
    illegal('Pick an Asterism to prophesy.');
  }
  s.stack.pop();
  ctx.events.push({ t: 'note', text: recordAsterism(s, frame.player, key, id) });
  finishRound(ctx);
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
  deadForInnumerableAges(ctx);
  morbidDetonations(ctx);
  // "For the rest of the turn" lasts through objective control (Celestial Conduit), which is
  // why the turn's effects are cleared after it.
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
  clearExpiredEffects(s, 'turn');
}

/**
 * Dead for Innumerable Ages (c5a7-920c-9ff8-652): at the end of any turn each damaged unit with
 * it rolls 3D6 and adds its damage points; 20+ destroys it, otherwise it heals 18.
 */
function deadForInnumerableAges(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const id of s.unitOrder) {
    const unit = s.units[id]!;
    if (unit.status !== 'battlefield' || unit.damage <= 0) continue;
    if (!hasWarscrollAbility(scenario, unit, DEAD_FOR_AGES_ID)) continue;
    const dice = [d6(ctx), d6(ctx), d6(ctx)];
    const total = dice[0]! + dice[1]! + dice[2]! + unit.damage;
    ctx.events.push({ t: 'roll', player: unit.owner, label: 'Dead for Innumerable Ages', dice });
    if (total >= 20) {
      ctx.events.push({
        t: 'note',
        text: `Dead for Innumerable Ages: ${unit.name} rolls ${total} (${dice.join('+')} plus ${unit.damage} damage points) and is destroyed.`,
      });
      destroyUnit(ctx, unit, 'Dead for Innumerable Ages');
    } else {
      ctx.events.push({
        t: 'note',
        text: `Dead for Innumerable Ages: ${unit.name} rolls ${total} (${dice.join('+')} plus ${unit.damage} damage points).`,
      });
      healUnit(ctx, unit, 18, 'Dead for Innumerable Ages');
    }
  }
}

export function advancePhase(ctx: Ctx): void {
  const { s } = ctx;
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
    if (next === 'combat') offerStartOfCombat(ctx);
    return;
  }
  beginTurnEnd(ctx);
}

/**
 * The start of the combat phase (Core 13.0, 13.1): abilities that are not FIGHT abilities are used
 * before fighting starts, the active player's first and then the defender's. Rhythm of the Chase,
 * Groundshaker, Venomite Swarm and Ark of Sotek are such abilities (owner, 2026-11-20; R14). The defender's Fury of The Forest comes after their own.
 */
function offerStartOfCombat(ctx: Ctx): void {
  const { s, scenario } = ctx;
  offerFuryOfTheForest(ctx);
  for (const player of [opponent(s.active), s.active]) {
    // Always pushed: what the player can use is worked out when the window comes up, after the
    // other player's abilities (settle drops an empty one).
    const options = startOfCombatAbilities(scenario, s, player);
    s.stack.push({ t: 'reaction', player, options, trigger: 'start:combat', window: true });
  }
}

/**
 * Fury of The Forest ("Enemy Combat Phase"): at the start of the enemy's combat phase, before
 * any unit fights, the other player may give a unit in combat with only 1 enemy unit
 * Strike-first (see docs/RULES-DECISIONS.md).
 */
function offerFuryOfTheForest(ctx: Ctx): void {
  const { s, scenario } = ctx;
  const player = opponent(s.active);
  const options: ReactionOption[] = unitsOf(s, player)
    .filter((u) => canFuryOfTheForest(scenario, s, u))
    .map((u) => ({ command: 'furyOfTheForest', unit: u.id, cost: COMMANDS.furyOfTheForest.cost }));
  if (options.length === 0) return;
  s.stack.push({ t: 'reaction', player, options, trigger: 'start:combat' });
}

/**
 * The end of a turn (Core 13.0, 31.0; owner ruling 2026-11-20, I111): the active player's
 * end-of-turn abilities resolve first, then the other player's, and objective control and
 * scoring come after all of them. Within a player's set the order is fixed: Endless Growth
 * (the heal, resolved by `settle` from an `endGrowth` frame), Huntmaster's Strike, then
 * Vengeance of Azyr. `settle` calls `finishTurn` once nothing is waiting.
 */
function beginTurnEnd(ctx: Ctx): void {
  const { s, scenario } = ctx;
  s.stack.push({ t: 'turnEnd' });
  // The stack resolves from the top, so the other player's frames go on first.
  for (const player of [opponent(s.active), s.active]) {
    if (vengeanceCandidates(scenario, s, player).length > 0) {
      s.stack.push({ t: 'vengeance', player, stage: 'pick', queue: [] });
    }
    // Huntmaster's Strike ("End of Any Turn"): a unit that charged this turn.
    const options: ReactionOption[] = unitsOf(s, player)
      .filter((u) => canHuntmaster(scenario, s, u))
      .map((u) => ({ ability: 'huntmastersStrike', unit: u.id, cost: 0 }));
    if (options.length > 0) s.stack.push({ t: 'reaction', player, options, trigger: 'end:turn' });
    s.stack.push({ t: 'endGrowth', player });
  }
}

/** Scores the turn that has ended and begins the next turn, round or the end of the game. */
export function finishTurn(ctx: Ctx): void {
  const { s, scenario } = ctx;
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
