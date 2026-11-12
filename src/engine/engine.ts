import { battleplanRules } from '../rules/battleplans/index.js';
import {
  clearPhaseCommands,
  commandBlocker,
  COMMANDS,
  payCommand,
} from '../rules/core/commands.js';
import { resolveControl } from '../rules/core/objectives.js';
import { rallyPoints, rallySpend, RALLY_ROLLS } from '../rules/core/rally.js';
import { priorityWinner, roundCommandPoints, seizes } from '../rules/core/round.js';
import { clearExpiredEffects, fireTriggers, strikeOrder, unitGrants } from './abilities/effects.js';
import './abilities/lores.js';
import { declareAbility, magicOptionsForUnit, resolvePendingSpell } from './abilities/magic.js';
import { checkAllocations, mayShoot, resolveAttacks, weaponTargets } from './combat.js';
import { d6, d6s, illegal, rollD3, type Ctx } from './ctx.js';
import { inflictMortalDamage, returnPosition } from './damage.js';
import { checkMovePlacement, PILE_IN_DISTANCE, placementDistance } from './movement.js';
import {
  CHARGE_END_RANGE,
  DIST_EPS,
  enemiesInCombat,
  enemiesWithin,
  inCombat,
  isFactionTerrainUnit,
  nearEnemyFactionTerrain,
  opponent,
  profileOf,
  unitById,
  unitDistance,
  unitsOf,
  unitsWithin,
} from './query.js';
import { RngCursor, rngFromSeed } from './rng.js';
import { deployArmies } from './setup.js';
import {
  buildDeploymentFrames,
  checkDeployPlacement,
  createReserveUnits,
  npcDeployPlacement,
  placeFactionTerrain,
} from './deployment.js';
import {
  evaluateEndOfTurnTactics,
  initBattleTactics,
  needsFugitive,
  fugitiveCandidates,
  suggestFugitive,
  recordTurnStartForTactics,
} from '../rules/core/battleTactics.js';
import {
  applySimmeringRage,
  canUseEruptionOfFury,
  eruptionOfFuryTargets,
  initFury,
  resolveEruptionOfFury,
} from '../rules/core/fury.js';
import { canUsePlaceOfPower, resolvePlaceOfPower, type PlaceOfPowerBoon } from './terrain.js';
import { applyEverGrowing, resolveEndlessGrowth } from '../rules/factions/sylvaneth.js';
import {
  PHASES,
  type Action,
  type Allocation,
  type AttackMode,
  type CommandId,
  type Decision,
  type Engine,
  type FightTier,
  type Frame,
  type GameState,
  type MoveKind,
  type NewGameOptions,
  type Placement,
  type PlayerId,
  type ReactionOption,
  type Scenario,
  type StepResult,
  type UnitId,
  type UnitOption,
  type UnitState,
  type Violation,
  type WeaponTargets,
} from './types.js';

/** Command points each player receives at the start of a battle round (before the underdog). */
export const CP_PER_ROUND = 4;
/** The longest charge roll, plus the 1/2" a charge may end from its target. */
export const MAX_CHARGE_REACH = 12 + CHARGE_END_RANGE;

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
    ...(state.alarielleSeason ? { alarielleSeason: { ...state.alarielleSeason } } : {}),
  };
}

// ─── Turn sequence ──────────────────────────────────────────────────────────────

function startTurn(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const id of s.unitOrder) {
    const u = s.units[id]!;
    u.moved = null;
    u.charged = false;
    u.shot = false;
    u.fought = false;
    u.chargeDeclared = false;
    u.allOutAttack = false;
    u.castsUsed = 0;
    u.abilitiesUsed = [];
    u.setUpThisTurn = false;
    u.magicalIntervention = false;
  }
  for (const p of s.players) {
    p.spellsAttempted = [];
    p.furyUsedThisTurn = [];
  }
  s.usedPlacesOfPower = [];
  recordTurnStartForTactics(scenario, s);
  s.banishedThisTurn = [];
  s.reactionsOffered = [];
  s.fightTier = null;
  clearExpiredEffects(s, 'startOfNextTurn', s.active);
  clearPhaseCommands(s);
  s.phase = 'hero';
  s.fightPicker = null;
  ctx.events.push({ t: 'turnStart', player: s.active, round: s.round });
  ctx.events.push({ t: 'phaseStart', phase: s.phase, player: s.active });
}

/** After priority: command points (with the underdog's extra point), then the first turn. */
function beginRound(ctx: Ctx): void {
  const { s } = ctx;
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].cp = roundCommandPoints(s, p);
    ctx.events.push({ t: 'commandPoints', player: p, cp: s.players[p].cp });
  }
  s.turnIndex = 0;
  s.active = s.firstPlayer;
  const alarielle = Object.values(s.units).find(
    (u) => u.status === 'battlefield' && u.name.toLowerCase().includes('alarielle'),
  );
  if (alarielle && !s.alarielleSeason?.[s.round]) {
    s.alarielleSeason = { ...(s.alarielleSeason ?? {}), [s.round]: 'burgeoning' };
  }
  startTurn(ctx);
}

function startRound(ctx: Ctx): void {
  const { s, scenario } = ctx;
  ctx.events.push({ t: 'roundStart', round: s.round });
  s.seizedThisRound = null;
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].cp = 0;
    s.players[p].vpByRound.push(0);
  }
  if (s.round === 1) {
    initFury(s, 0);
    initBattleTactics(scenario, s);
  }
  applySimmeringRage(s);
  for (const text of applyEverGrowing(scenario, s)) ctx.events.push({ t: 'note', text });
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
function roundOneFirstTurn(ctx: Ctx): void {
  const { s, scenario } = ctx;
  for (const p of [0, 1] as PlayerId[]) {
    if (needsFugitive(scenario, s, p)) {
      s.stack.push({ t: 'fugitive', player: p, units: fugitiveCandidates(scenario, s, p) });
      return;
    }
  }
  // Round 1: the attacker (player 0) takes the first turn.
  s.firstPlayer = 0;
  beginRound(ctx);
}

function chooseFugitive(ctx: Ctx, value: string): void {
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

function choosePriority(ctx: Ctx, value: string): void {
  const { s } = ctx;
  const frame = s.stack.pop();
  if (frame?.t !== 'priority') illegal('There is no priority choice to make.');
  if (value !== 'first' && value !== 'second') illegal('Choose "first" or "second".');
  const first = value === 'first' ? frame.winner : opponent(frame.winner);
  if (seizes(s, frame.winner, s.firstPlayer, first)) {
    s.seizedBy = first;
    s.seizedThisRound = first;
    ctx.events.push({ t: 'note', text: `Player ${first + 1} seizes the initiative.` });
  }
  s.firstPlayer = first;
  beginRound(ctx);
}

function endGame(ctx: Ctx): void {
  const { s } = ctx;
  const [a, b] = [s.players[0].vp, s.players[1].vp];
  s.status = 'ended';
  s.winner = a === b ? 'draw' : a > b ? 0 : 1;
  ctx.events.push({ t: 'gameEnd', winner: s.winner, vp: [a, b] });
}

/** End of a turn: resolve objective control, then the player whose turn it was scores. */
function endTurn(ctx: Ctx): void {
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
    ctx.events.push({ t: 'score', player, vp: st.vp, reason: `${st.cardName} (${st.tacticName})` });
  }
}

function advancePhase(ctx: Ctx): void {
  const { s, scenario } = ctx;
  clearPhaseCommands(s);
  clearExpiredEffects(s, 'phase');
  s.reactionsOffered = [];
  for (const id of s.unitOrder) {
    const u = s.units[id]!;
    u.castsUsed = 0;
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

// ─── Eligibility ────────────────────────────────────────────────────────────────

function moveOptions(scenario: Scenario, state: GameState, unit: UnitState): UnitOption[] {
  if (unit.moved !== null || unit.setUpThisTurn || isFactionTerrainUnit(scenario, unit)) return [];
  const profile = profileOf(scenario, unit);
  if (profile.move <= 0 && !profile.moveDice) return [];
  if (inCombat(scenario, state, unit)) {
    if (unit.isManifestation) return [];
    return [{ t: 'move', kind: 'retreat', allowance: profile.move }];
  }
  const grants = unitGrants(scenario, state, unit);
  const out: UnitOption[] = [{ t: 'move', kind: 'normal', allowance: profile.move }];
  if (!grants.cannotRun && !unit.isManifestation) {
    out.push({ t: 'move', kind: 'run', allowance: profile.move });
  }
  return out;
}

function rawEligibleFighters(scenario: Scenario, state: GameState, player: PlayerId): UnitState[] {
  return unitsOf(state, player).filter((u) => {
    if (u.fought || isFactionTerrainUnit(scenario, u)) return false;
    if (u.isManifestation && !profileOf(scenario, u).weapons.some((w) => w.kind === 'melee')) {
      return false;
    }
    return u.charged || inCombat(scenario, state, u) || optionalFighter(scenario, state, u);
  });
}

/**
 * A unit that may fight only because it is within 3" of enemy faction terrain: it is not
 * obliged to (owner's ruling, 2026-11-11), so the picker may pass for it.
 */
function optionalFighter(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (unit.charged || inCombat(scenario, state, unit)) return false;
  return (
    profileOf(scenario, unit).weapons.some((w) => w.kind === 'melee') &&
    nearEnemyFactionTerrain(scenario, state, unit)
  );
}

export function currentFightTier(scenario: Scenario, state: GameState): FightTier | null {
  const all = [
    ...rawEligibleFighters(scenario, state, 0),
    ...rawEligibleFighters(scenario, state, 1),
  ];
  if (all.length === 0) return null;
  const tiers = new Set(all.map((u) => strikeOrder(scenario, state, u)));
  if (tiers.has('strikeFirst')) return 'strikeFirst';
  if (tiers.has('normal')) return 'normal';
  if (tiers.has('strikeLast')) return 'strikeLast';
  return null;
}

/**
 * Units of `player` that may be picked to fight in the current strike-order tier:
 * STRIKE-FIRST units first, then normal, then STRIKE-LAST.
 */
export function eligibleFighters(
  scenario: Scenario,
  state: GameState,
  player: PlayerId,
): UnitState[] {
  const tier = currentFightTier(scenario, state);
  if (!tier) return [];
  return rawEligibleFighters(scenario, state, player).filter(
    (u) => strikeOrder(scenario, state, u) === tier,
  );
}

function canCharge(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (unit.chargeDeclared || unit.moved === 'retreat') return false;
  if (isFactionTerrainUnit(scenario, unit)) return false;
  if (unit.isManifestation && !profileOf(scenario, unit).weapons.some((w) => w.kind === 'melee')) {
    return false;
  }
  const grants = unitGrants(scenario, state, unit);
  if (unit.moved === 'run' && !grants.runAndCharge) return false;
  if (inCombat(scenario, state, unit)) return false;
  return enemiesWithin(scenario, state, unit, MAX_CHARGE_REACH).length > 0;
}

function canRally(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(state, unit.owner, 'rally', unit)) return false;
  if (isFactionTerrainUnit(scenario, unit)) return false;
  if (inCombat(scenario, state, unit)) return false;
  return unit.damage > 0 || unit.models.some((m) => !m.alive);
}

function canRedeploy(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(state, unit.owner, 'redeploy', unit)) return false;
  if (inCombat(scenario, state, unit) || unit.moved !== null) return false;
  if (isFactionTerrainUnit(scenario, unit)) return false;
  return profileOf(scenario, unit).move > 0;
}

function canCounterCharge(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(state, unit.owner, 'counterCharge', unit)) return false;
  return canCharge(scenario, state, unit);
}

function coveringFireAllocations(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): Allocation[] {
  if (commandBlocker(state, unit.owner, 'coveringFire', unit)) return [];
  if (isFactionTerrainUnit(scenario, unit)) return [];
  const wts = weaponTargets(scenario, state, unit, 'shoot');
  if (wts.length === 0) return [];
  const allEnemies = unitsOf(state, opponent(unit.owner));
  if (allEnemies.length === 0) return [];
  let minDist = Infinity;
  for (const e of allEnemies) {
    const d = unitDistance(scenario, unit, e);
    if (d < minDist) minDist = d;
  }
  const closestIds = new Set(
    allEnemies
      .filter((e) => unitDistance(scenario, unit, e) <= minDist + DIST_EPS + 0.05)
      .map((e) => e.id),
  );
  const allocations: Allocation[] = [];
  for (const wt of wts) {
    const legalClosest = wt.targets
      .filter((t) => closestIds.has(t.unit))
      .sort((a, b) => b.expectedDamage - a.expectedDamage);
    if (legalClosest.length > 0) {
      allocations.push({ weaponId: wt.weaponId, target: legalClosest[0]!.unit });
    }
  }
  return allocations;
}

function canMagicalIntervention(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  if (commandBlocker(state, unit.owner, 'magicalIntervention', unit)) return false;
  const probe: GameState = {
    ...state,
    stack: [...state.stack, { t: 'magicalIntervention', unit: unit.id }],
  };
  return magicOptionsForUnit(scenario, probe, unit).length > 0;
}

export function powerThroughTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitId[] {
  if (!unit.charged || commandBlocker(state, unit.owner, 'powerThrough', unit)) return [];
  const myHealth = profileOf(scenario, unit).health;
  const engaged = enemiesInCombat(scenario, state, unit);
  if (engaged.length === 0) return [];
  return engaged.filter((e) => profileOf(scenario, e).health < myHealth).map((e) => e.id);
}

// ─── Engine ─────────────────────────────────────────────────────────────────────

export function createEngine(scenario: Scenario): Engine {
  function fightPickerFor(state: GameState): PlayerId | null {
    const tier = currentFightTier(scenario, state);
    if (!tier) return null;
    const first = state.fightTier === tier ? (state.fightPicker ?? state.active) : state.active;
    if (eligibleFighters(scenario, state, first).length > 0) return first;
    const other = opponent(first);
    return eligibleFighters(scenario, state, other).length > 0 ? other : null;
  }

  function decision(state: GameState): Decision | null {
    if (state.status === 'ended') return null;
    const top = state.stack[state.stack.length - 1];
    if (top) {
      switch (top.t) {
        case 'priority':
          return { kind: 'priority', player: top.winner, rolls: top.rolls };
        case 'place':
          return {
            kind: 'place',
            player: unitById(state, top.unit).owner,
            unit: top.unit,
            reason: top.reason,
            allowance: top.allowance,
            dice: top.dice,
            canPass: top.reason !== 'deploy',
          };
        case 'targets':
          return {
            kind: 'targets',
            player: unitById(state, top.unit).owner,
            unit: top.unit,
            mode: top.mode,
          };
        case 'reaction':
          return {
            kind: 'reaction',
            player: top.player,
            options: top.options,
            trigger: top.trigger,
          };
        case 'magicalIntervention':
          return {
            kind: 'main',
            player: unitById(state, top.unit).owner,
            phase: 'hero',
          };
        case 'placeOfPower':
          return {
            kind: 'placeOfPower',
            player: top.player,
            hero: top.hero,
            terrain: top.terrain,
            boons: ['ignite_fury', 'channelled_wrath', 'dizzying_rage'],
          };
        case 'alarielleSeason':
          return {
            kind: 'alarielleSeason',
            player: top.player,
            unit: top.unit,
            seasons: ['burgeoning', 'reaping', 'dwindling', 'everdusk'],
          };
        case 'fugitive':
          return { kind: 'fugitive', player: top.player, units: top.units };
        case 'resolve':
        case 'spell':
        case 'endPhase':
          throw new Error(`internal: unresolved ${top.t} frame on top of the stack`);
      }
    }
    if (state.phase === 'combat') {
      const picker = fightPickerFor(state);
      if (picker !== null) {
        // Passing is allowed only when every unit the picker could fight with is merely
        // near enemy faction terrain.
        const canPass = eligibleFighters(scenario, state, picker).every((u) =>
          optionalFighter(scenario, state, u),
        );
        return { kind: 'fightPick', player: picker, canPass };
      }
    }
    return { kind: 'main', player: state.active, phase: state.phase };
  }

  function unitOptions(state: GameState, unitId: UnitId): UnitOption[] {
    const d = decision(state);
    const unit = state.units[unitId];
    if (!d || !unit || unit.status !== 'battlefield' || unit.owner !== d.player) return [];
    if (isFactionTerrainUnit(scenario, unit)) return [];
    const top = state.stack[state.stack.length - 1];
    if (top?.t === 'magicalIntervention') {
      if (top.unit !== unitId) return [];
      return magicOptionsForUnit(scenario, state, unit);
    }
    if (d.kind === 'fightPick') {
      return eligibleFighters(scenario, state, d.player).some((u) => u.id === unitId)
        ? [{ t: 'fight' }]
        : [];
    }
    if (d.kind !== 'main') return [];
    switch (d.phase) {
      case 'hero': {
        const opts: UnitOption[] = [...magicOptionsForUnit(scenario, state, unit)];
        if (canRally(scenario, state, unit)) {
          opts.push({ t: 'command', command: 'rally', cost: 1 });
        }
        if (canUsePlaceOfPower(scenario, state, unit)) {
          opts.push({
            t: 'ability',
            abilityId: 'place-of-power',
            name: 'Place of Power (Start of Turn)',
            kind: 'activated',
            targets: [],
          });
        }
        return opts;
      }
      case 'movement': {
        const moves = moveOptions(scenario, state, unit);
        const canRun = moves.some((o) => o.t === 'move' && o.kind === 'run');
        if (canRun && !commandBlocker(state, unit.owner, 'atTheDouble', unit)) {
          return [...moves, { t: 'command', command: 'atTheDouble', cost: 1 }];
        }
        return moves;
      }
      case 'shooting': {
        const grants = unitGrants(scenario, state, unit);
        return mayShoot(unit, grants.runAndShoot) &&
          weaponTargets(scenario, state, unit, 'shoot').length > 0
          ? [{ t: 'shoot' }]
          : [];
      }
      case 'charge': {
        const opts: UnitOption[] = [];
        if (canCharge(scenario, state, unit)) opts.push({ t: 'charge' });
        if (
          unit.chargeDeclared &&
          !unit.charged &&
          !commandBlocker(state, unit.owner, 'forwardToVictory', unit)
        ) {
          opts.push({ t: 'command', command: 'forwardToVictory', cost: 1 });
        }
        return opts;
      }
      case 'end': {
        const opts: UnitOption[] = [];
        const targets = powerThroughTargets(scenario, state, unit);
        if (targets.length > 0) {
          opts.push({ t: 'command', command: 'powerThrough', cost: 1, targets });
        }
        if (canUseEruptionOfFury(scenario, state, unit)) {
          opts.push({
            t: 'ability',
            abilityId: 'eruption-of-fury',
            name: 'Eruption of Fury',
            kind: 'activated',
            targets: eruptionOfFuryTargets(scenario, state, unit).map((u) => u.id),
          });
        }
        return opts;
      }
      default:
        return [];
    }
  }

  function targetOptions(state: GameState, unitId: UnitId, mode: AttackMode): WeaponTargets[] {
    const unit = state.units[unitId];
    return unit ? weaponTargets(scenario, state, unit, mode) : [];
  }

  function checkPlacement(state: GameState, placement: Placement): Violation[] {
    const d = decision(state);
    if (!d || d.kind !== 'place') {
      return [{ code: 'BLOCKED', message: 'No unit is being placed right now.' }];
    }
    if (placement.unit !== d.unit) {
      return [{ code: 'WRONG_MODELS', message: 'That is not the unit being placed.' }];
    }
    if (d.reason === 'deploy') {
      return checkDeployPlacement(scenario, state, unitById(state, d.unit), placement);
    }
    const top = state.stack[state.stack.length - 1];
    return checkMovePlacement(scenario, state, unitById(state, d.unit), placement, {
      reason: d.reason,
      allowance: d.allowance,
      ...(top?.t === 'place' && top.caster ? { caster: top.caster } : {}),
      ...(top?.t === 'place' && top.minEnemyGap !== undefined
        ? { minEnemyGap: top.minEnemyGap }
        : {}),
    });
  }

  // ─── Actions ──────────────────────────────────────────────────────────────────

  function useCommandOn(ctx: Ctx, command: CommandId, unit: UnitState): void {
    const blocker = commandBlocker(ctx.s, unit.owner, command, unit);
    if (blocker) illegal(blocker);
    payCommand(ctx.s, unit.owner, command, unit);
    ctx.events.push({ t: 'command', player: unit.owner, command, unit: unit.id });
  }

  function declareMove(ctx: Ctx, unitId: UnitId, kind: MoveKind, atTheDouble = false): void {
    const { s } = ctx;
    const option = unitOptions(s, unitId).find((o) => o.t === 'move' && o.kind === kind);
    if (!option || option.t !== 'move') illegal(`That unit cannot ${kind} now.`);
    const unit = s.units[unitId]!;
    const dice: number[] = [];
    let allowance = option.allowance;
    if (atTheDouble) {
      if (kind !== 'run') illegal('At the Double is used with a run.');
      useCommandOn(ctx, 'atTheDouble', unit);
      dice.push(6);
      allowance += 6;
      unit.moved = 'run';
    } else if (kind === 'run') {
      const roll = d6(ctx);
      dice.push(roll);
      allowance += roll;
      // A run is committed once the die is rolled, whether or not the unit then moves.
      unit.moved = 'run';
      ctx.events.push({ t: 'roll', player: s.active, label: 'Run', dice: [roll] });
    }
    s.stack.push({ t: 'place', unit: unitId, reason: kind, allowance, dice });
  }

  function rally(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit || !canRally(scenario, s, unit)) illegal('That unit cannot rally now.');
    useCommandOn(ctx, 'rally', unit);
    const dice = d6s(ctx, RALLY_ROLLS);
    ctx.events.push({ t: 'roll', player: unit.owner, label: 'Rally', dice });
    const health = profileOf(scenario, unit).health;
    const dead = unit.models.flatMap((m, i) => (m.alive ? [] : [i]));
    let points = rallyPoints(dice);
    const spend = rallySpend(points, health, dead.length, unit.damage);
    let returned = 0;
    for (const i of dead.slice(0, spend.returnModels)) {
      const at = returnPosition(scenario, s, unit, i);
      if (!at) break;
      Object.assign(unit.models[i]!, at, { alive: true });
      points -= health;
      returned++;
    }
    const healed = Math.min(points, unit.damage);
    unit.damage -= healed;
    ctx.events.push({
      t: 'note',
      text: `${unit.name} rallies: ${returned} model(s) returned, ${healed} damage healed.`,
    });
  }

  function redeploy(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit || !canRedeploy(scenario, s, unit)) illegal('That unit cannot redeploy now.');
    useCommandOn(ctx, 'redeploy', unit);
    const roll = d6(ctx);
    ctx.events.push({ t: 'roll', player: unit.owner, label: 'Redeploy', dice: [roll] });
    unit.moved = 'normal';
    s.stack.push({ t: 'place', unit: unit.id, reason: 'normal', allowance: roll, dice: [roll] });
  }

  function coveringFire(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit) illegal('Unknown unit.');
    const allocations = coveringFireAllocations(scenario, s, unit);
    if (allocations.length === 0) illegal('That unit cannot use Covering Fire now.');
    useCommandOn(ctx, 'coveringFire', unit);
    unit.shot = true;
    startAttacks(ctx, unit, 'shoot', allocations, false, true);
  }

  function counterCharge(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit || !canCounterCharge(scenario, s, unit)) {
      illegal('That unit cannot use Counter-charge now.');
    }
    useCommandOn(ctx, 'counterCharge', unit);
    unit.chargeDeclared = true;
    rollAndPushCharge(ctx, unit);
  }

  function magicalIntervention(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit || !canMagicalIntervention(scenario, s, unit)) {
      illegal('That unit cannot use Magical Intervention now.');
    }
    useCommandOn(ctx, 'magicalIntervention', unit);
    unit.magicalIntervention = true;
    s.stack.push({ t: 'magicalIntervention', unit: unit.id });
  }

  function powerThrough(ctx: Ctx, unitId: UnitId, targetId?: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit) illegal('Unknown unit.');
    const targets = powerThroughTargets(scenario, s, unit);
    if (targets.length === 0) illegal('That unit cannot use Power Through now.');
    const chosenId = targetId ?? targets[0]!;
    if (!targets.includes(chosenId)) {
      illegal(
        'Power Through must target an engaged enemy unit with a lower Health characteristic.',
      );
    }
    const target = unitById(s, chosenId);
    useCommandOn(ctx, 'powerThrough', unit);
    const dmg = rollD3(ctx, unit.owner, 'Power Through (D3 mortal damage)');
    inflictMortalDamage(ctx, target, dmg, 'Power Through');
    const allowance = profileOf(scenario, unit).move;
    s.stack.push({
      t: 'place',
      unit: unit.id,
      reason: 'powerThrough',
      allowance,
      dice: [],
    });
  }

  function forwardToVictory(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    const unit = s.units[unitId];
    if (!unit || !unit.chargeDeclared || unit.charged) {
      illegal('Forward to Victory can only be used after a charge roll.');
    }
    useCommandOn(ctx, 'forwardToVictory', unit);
    const top = s.stack[s.stack.length - 1];
    if (top?.t === 'place' && top.unit === unitId && top.reason === 'charge') {
      s.stack.pop();
    }
    rollAndPushCharge(ctx, unit);
  }

  function rollAndPushCharge(ctx: Ctx, unit: UnitState): void {
    const { s } = ctx;
    const dice: [number, number] = [d6(ctx), d6(ctx)];
    const mod = unitGrants(scenario, s, unit).chargeRollModifier;
    const roll = Math.max(0, dice[0] + dice[1] + mod);
    const success =
      roll > 0 &&
      unitsOf(s, opponent(unit.owner)).some((e) =>
        unitsWithin(scenario, unit, e, roll + CHARGE_END_RANGE),
      );
    ctx.events.push({ t: 'chargeRoll', unit: unit.id, dice, success });
    if (success) {
      s.stack.push({ t: 'place', unit: unit.id, reason: 'charge', allowance: roll, dice });
    }
  }

  function place(ctx: Ctx, placement: Placement): void {
    const { s } = ctx;
    const frame = s.stack[s.stack.length - 1];
    if (!frame || frame.t !== 'place') illegal('No unit is being placed right now.');
    const violations = checkPlacement(s, placement);
    if (violations.length > 0) illegal(violations[0]!.message, violations);
    const unit = s.units[frame.unit]!;
    const distance =
      frame.reason === 'summon' || frame.reason === 'deploy'
        ? 0
        : placementDistance(unit, placement);
    for (const m of placement.models) {
      const model = unit.models[m.i]!;
      model.x = m.x;
      model.y = m.y;
      model.rot = m.rot;
    }
    if (frame.reason === 'deploy') {
      unit.status = 'battlefield';
      unit.setUpThisTurn = true;
    }
    if (frame.reason === 'normal' || frame.reason === 'run' || frame.reason === 'retreat') {
      unit.moved = frame.reason;
    }
    if (frame.reason === 'charge') unit.charged = true;
    s.stack.pop();
    ctx.events.push({ t: 'moved', unit: unit.id, kind: frame.reason, dice: frame.dice, distance });
    if (frame.reason === 'deploy' && s.stack.length === 0) {
      startRound(ctx);
    }
    if (frame.reason === 'retreat') {
      const roll = ctx.rng.int(1, 3);
      ctx.events.push({
        t: 'roll',
        player: unit.owner,
        label: 'Retreat (D3 mortal damage)',
        dice: [roll],
      });
      inflictMortalDamage(ctx, unit, roll, 'Retreat');
    }

    if (frame.reason !== 'summon' && frame.reason !== 'deploy' && unit.status === 'battlefield') {
      fireTriggers(ctx, 'afterMove', {
        unit,
        moveKind:
          frame.reason === 'normal' || frame.reason === 'run' || frame.reason === 'retreat'
            ? frame.reason
            : undefined,
      });
    }

    // Offer Redeploy reaction when an active player's unit finishes a movement-phase move within 6" of an enemy unit
    if (
      s.phase === 'movement' &&
      unit.owner === s.active &&
      (frame.reason === 'normal' || frame.reason === 'run' || frame.reason === 'retreat') &&
      !(s.reactionsOffered ?? []).includes('redeploy')
    ) {
      const nonActive = opponent(s.active);
      const candidates = unitsOf(s, nonActive).filter(
        (u) => canRedeploy(scenario, s, u) && unitsWithin(scenario, unit, u, 6),
      );
      if (candidates.length > 0) {
        s.reactionsOffered = [...(s.reactionsOffered ?? []), 'redeploy'];
        s.stack.push({
          t: 'reaction',
          player: nonActive,
          options: candidates.map((u) => ({
            command: 'redeploy',
            unit: u.id,
            cost: COMMANDS.redeploy.cost,
          })),
          trigger: `move:${unit.id}`,
        });
      }
    }
  }

  function skipPlace(ctx: Ctx): void {
    const frame = ctx.s.stack.pop();
    if (frame?.t === 'place' && frame.reason === 'charge') {
      ctx.events.push({ t: 'note', text: `${ctx.s.units[frame.unit]!.name}'s charge fails.` });
    }
  }

  function declareCharge(ctx: Ctx, unitId: UnitId): void {
    const { s } = ctx;
    if (!unitOptions(s, unitId).some((o) => o.t === 'charge'))
      illegal('That unit cannot charge now.');
    const unit = s.units[unitId]!;
    unit.chargeDeclared = true;
    rollAndPushCharge(ctx, unit);
  }

  /** Pays for All-out Attack, then offers All-out Defence or resolves the attacks. */
  function startAttacks(
    ctx: Ctx,
    unit: UnitState,
    mode: AttackMode,
    allocations: Allocation[],
    allOutAttack: boolean,
    isCoveringFire = false,
  ): void {
    const { s } = ctx;
    if (allOutAttack) {
      useCommandOn(ctx, 'allOutAttack', unit);
      unit.allOutAttack = true;
    }
    const frame: Extract<Frame, { t: 'resolve' }> = {
      t: 'resolve',
      unit: unit.id,
      mode,
      allocations,
      allOutAttack,
      defended: [],
      ...(isCoveringFire ? { coveringFire: true } : {}),
    };
    const defender = opponent(unit.owner);
    const options: ReactionOption[] = [];
    for (const id of new Set(allocations.map((a) => a.target))) {
      const target = s.units[id]!;
      if (!commandBlocker(s, defender, 'allOutDefence', target)) {
        options.push({ command: 'allOutDefence', unit: id, cost: 1 });
      }
    }
    if (options.length > 0) {
      s.stack.push(frame);
      s.stack.push({ t: 'reaction', player: defender, options, trigger: `${mode}:${unit.id}` });
    } else {
      resolveAttacks(ctx, frame);
    }
  }

  function answerReaction(ctx: Ctx, action: Action): void {
    const { s } = ctx;
    const reaction = s.stack[s.stack.length - 1];
    if (reaction?.t !== 'reaction') illegal('There is no reaction to answer.');

    const under = s.stack[s.stack.length - 2];

    // 1. Unbind reaction to a pending spell
    if (under?.t === 'spell') {
      if (action.t === 'ability' && action.abilityId === 'unbind') {
        const ok = reaction.options.some((o) => o.ability === 'unbind' && o.unit === action.unit);
        if (!ok) illegal('That unit cannot unbind this spell.');
        s.stack.pop(); // reaction
        const spellFrame = s.stack.pop() as Extract<Frame, { t: 'spell' }>;
        resolvePendingSpell(ctx, spellFrame, action.unit);
        return;
      }
      if (action.t === 'pass') {
        s.stack.pop(); // reaction
        const spellFrame = s.stack.pop() as Extract<Frame, { t: 'spell' }>;
        resolvePendingSpell(ctx, spellFrame);
        return;
      }
      illegal('Unbind the spell or pass.');
    }

    // 2. All-out Defence reaction to pending attacks
    if (under?.t === 'resolve') {
      let defended: UnitId[] = [];
      if (action.t === 'command') {
        const ok = reaction.options.some(
          (o) => o.command === action.command && o.unit === action.unit,
        );
        if (!ok) illegal('That reaction is not available.');
        useCommandOn(ctx, 'allOutDefence', s.units[action.unit]!);
        defended = [action.unit];
      } else if (action.t !== 'pass') {
        illegal('Use a reaction or pass.');
      }
      s.stack.pop();
      const pending = s.stack.pop() as Extract<Frame, { t: 'resolve' }>;
      resolveAttacks(ctx, { ...pending, defended });
      return;
    }

    // 3. Phase / move command reactions (rally, redeploy, coveringFire, counterCharge, magicalIntervention, powerThrough)
    s.stack.pop(); // pop reaction frame (leaving `endPhase` on the stack if present)
    if (action.t === 'pass') {
      if (under?.t === 'endPhase') {
        s.reactionsOffered = [...(s.reactionsOffered ?? []), 'endPhasePassed'];
      }
      return;
    }
    if (action.t === 'command') {
      const ok = reaction.options.some(
        (o) => o.command === action.command && o.unit === action.unit,
      );
      if (!ok) illegal('That reaction is not available.');
      executeReactionCommand(ctx, action.command, action.unit, action.target);
      return;
    }
    illegal('Use a reaction or pass.');
  }

  function executeReactionCommand(
    ctx: Ctx,
    command: CommandId,
    unitId: UnitId,
    targetId?: UnitId,
  ): void {
    switch (command) {
      case 'rally':
        rally(ctx, unitId);
        break;
      case 'redeploy':
        redeploy(ctx, unitId);
        break;
      case 'coveringFire':
        coveringFire(ctx, unitId);
        break;
      case 'counterCharge':
        counterCharge(ctx, unitId);
        break;
      case 'magicalIntervention':
        magicalIntervention(ctx, unitId);
        break;
      case 'powerThrough':
        powerThrough(ctx, unitId, targetId);
        break;
      default:
        illegal(`Command ${command} cannot be used here.`);
    }
  }

  function offerEndOfPhaseReaction(ctx: Ctx): boolean {
    const { s } = ctx;
    const nonActive = opponent(s.active);
    const offered = s.reactionsOffered ?? [];
    if (offered.includes('endPhasePassed')) return false;

    if (s.phase === 'hero') {
      const options: ReactionOption[] = [];
      for (const u of unitsOf(s, nonActive)) {
        if (
          canMagicalIntervention(scenario, s, u) &&
          enemiesWithin(scenario, s, u, 18).length > 0
        ) {
          options.push({
            command: 'magicalIntervention',
            unit: u.id,
            cost: COMMANDS.magicalIntervention.cost,
          });
        }
        if (canRally(scenario, s, u)) {
          options.push({
            command: 'rally',
            unit: u.id,
            cost: COMMANDS.rally.cost,
          });
        }
      }
      if (options.length > 0) {
        if (s.stack[s.stack.length - 1]?.t !== 'endPhase') {
          s.stack.push({ t: 'endPhase' });
        }
        s.stack.push({
          t: 'reaction',
          player: nonActive,
          options,
          trigger: 'phase:hero',
        });
        return true;
      }
    }

    if (s.phase === 'shooting' && !offered.includes('coveringFire')) {
      const turnHadActivity = unitsOf(s, s.active).some(
        (u) => u.moved !== null || u.shot || (u.castsUsed ?? 0) > 0,
      );
      if (turnHadActivity) {
        const units = unitsOf(s, nonActive).filter(
          (u) => coveringFireAllocations(scenario, s, u).length > 0,
        );
        if (units.length > 0) {
          s.reactionsOffered = [...offered, 'coveringFire'];
          s.stack.push({ t: 'endPhase' });
          s.stack.push({
            t: 'reaction',
            player: nonActive,
            options: units.map((u) => ({
              command: 'coveringFire',
              unit: u.id,
              cost: COMMANDS.coveringFire.cost,
            })),
            trigger: 'phase:shooting',
          });
          return true;
        }
      }
    }

    if (s.phase === 'charge' && !offered.includes('counterCharge')) {
      const units = unitsOf(s, nonActive).filter(
        (u) => canCounterCharge(scenario, s, u) && enemiesWithin(scenario, s, u, 6).length > 0,
      );
      if (units.length > 0) {
        s.reactionsOffered = [...offered, 'counterCharge'];
        s.stack.push({ t: 'endPhase' });
        s.stack.push({
          t: 'reaction',
          player: nonActive,
          options: units.map((u) => ({
            command: 'counterCharge',
            unit: u.id,
            cost: COMMANDS.counterCharge.cost,
          })),
          trigger: 'phase:charge',
        });
        return true;
      }
    }

    if (s.phase === 'end' && !offered.includes('powerThrough')) {
      const units = unitsOf(s, nonActive).filter(
        (u) => powerThroughTargets(scenario, s, u).length > 0,
      );
      if (units.length > 0) {
        s.reactionsOffered = [...offered, 'powerThrough'];
        s.stack.push({ t: 'endPhase' });
        s.stack.push({
          t: 'reaction',
          player: nonActive,
          options: units.map((u) => ({
            command: 'powerThrough',
            unit: u.id,
            cost: COMMANDS.powerThrough.cost,
          })),
          trigger: 'phase:end',
        });
        return true;
      }
    }

    return false;
  }

  function declareShoot(ctx: Ctx, action: Extract<Action, { t: 'shoot' }>): void {
    const { s } = ctx;
    const unit = s.units[action.unit];
    if (!unit || !unitOptions(s, action.unit).some((o) => o.t === 'shoot')) {
      illegal('That unit cannot shoot now.');
    }
    if (action.allocations.length === 0) illegal('Pick a target for at least one weapon.');
    checkAllocations(weaponTargets(scenario, s, unit, 'shoot'), action.allocations);
    unit.shot = true;
    startAttacks(ctx, unit, 'shoot', action.allocations, action.allOutAttack ?? false);
  }

  function declareFight(ctx: Ctx, player: PlayerId, unitId: UnitId): void {
    const { s } = ctx;
    if (!eligibleFighters(scenario, s, player).some((u) => u.id === unitId)) {
      illegal('That unit cannot fight now.');
    }
    const tier = currentFightTier(scenario, s);
    s.units[unitId]!.fought = true;
    s.fightTier = tier;
    s.fightPicker = opponent(player);
    s.stack.push({ t: 'targets', unit: unitId, mode: 'fight' });
    s.stack.push({
      t: 'place',
      unit: unitId,
      reason: 'pileIn',
      allowance: PILE_IN_DISTANCE,
      dice: [],
    });
  }

  function declareTargets(ctx: Ctx, action: Extract<Action, { t: 'targets' }>): void {
    const { s } = ctx;
    const frame = s.stack[s.stack.length - 1];
    if (frame?.t !== 'targets') illegal('No unit is choosing targets.');
    const unit = s.units[frame.unit]!;
    checkAllocations(weaponTargets(scenario, s, unit, frame.mode), action.allocations);
    s.stack.pop();
    if (action.allocations.length === 0) {
      if (action.allOutAttack) illegal('All-out Attack needs at least one attack.');
      return;
    }
    startAttacks(ctx, unit, frame.mode, action.allocations, action.allOutAttack ?? false);
  }

  /** Settle completed helper frames (`targets` with no enemies, or `endPhase` after reactions). */
  function settle(ctx: Ctx): void {
    const { s } = ctx;
    for (;;) {
      const top = s.stack[s.stack.length - 1];
      if (!top) break;
      if (
        top.t === 'targets' &&
        weaponTargets(scenario, s, s.units[top.unit]!, top.mode).length === 0
      ) {
        s.stack.pop();
        ctx.events.push({
          t: 'note',
          text: `${s.units[top.unit]!.name} has no enemy in range to attack.`,
        });
        continue;
      }
      if (
        top.t === 'magicalIntervention' &&
        magicOptionsForUnit(scenario, s, s.units[top.unit]!).length === 0
      ) {
        const u = s.units[top.unit]!;
        u.magicalIntervention = false;
        s.stack.pop();
        continue;
      }
      if (top.t === 'placeOfPower') {
        const u = s.units[top.hero];
        if (!u || !canUsePlaceOfPower(scenario, s, u)) {
          s.stack.pop();
          continue;
        }
      }
      if (top.t === 'endPhase') {
        if (offerEndOfPhaseReaction(ctx)) {
          continue;
        }
        s.stack.pop();
        advancePhase(ctx);
        continue;
      }
      break;
    }
  }

  /**
   * Every action that names a unit must name a unit that exists and belongs to the player
   * who is deciding (the active player cannot act with enemy units, and vice versa).
   */
  function requireOwnUnit(state: GameState, unitId: UnitId, player: PlayerId): UnitState {
    const unit = state.units[unitId];
    if (!unit) illegal(`There is no unit "${unitId}".`);
    if (unit.owner !== player) illegal(`${unit.name} belongs to the other player.`);
    if (isFactionTerrainUnit(scenario, unit)) {
      illegal(`${unit.name} is faction terrain: it cannot move, shoot, charge or fight.`);
    }
    return unit;
  }

  function apply(state: GameState, action: Action): StepResult {
    const d = decision(state);
    if (!d) illegal('The game has ended.');
    if (
      'unit' in action &&
      typeof action.unit === 'string' &&
      (d.kind === 'main' || d.kind === 'fightPick' || d.kind === 'reaction')
    ) {
      requireOwnUnit(state, action.unit, d.player);
    }
    const s = cloneState(state);
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };

    switch (d.kind) {
      case 'priority':
        if (action.t !== 'choose') illegal('Choose to take the first or second turn.');
        choosePriority(ctx, action.value);
        break;
      case 'fugitive':
        if (action.t !== 'choose') illegal('Pick the enemy Hero to be the fugitive.');
        chooseFugitive(ctx, action.value);
        break;
      case 'main': {
        const top = s.stack[s.stack.length - 1];
        if (top?.t === 'magicalIntervention') {
          if (action.t === 'pass') {
            s.units[top.unit]!.magicalIntervention = false;
            s.stack.pop();
          } else if (action.t === 'ability' && action.unit === top.unit) {
            declareAbility(ctx, action);
          } else {
            illegal('Cast a spell, chant a prayer, or pass.');
          }
          break;
        }
        if (action.t === 'pass') {
          if (!offerEndOfPhaseReaction(ctx)) {
            advancePhase(ctx);
          }
        } else if (action.t === 'move') {
          declareMove(ctx, action.unit, action.kind, action.atTheDouble);
        } else if (action.t === 'ability' && action.abilityId === 'place-of-power') {
          const hero = s.units[action.unit]!;
          const terrain = canUsePlaceOfPower(scenario, s, hero);
          if (!terrain) illegal(`${hero.name} cannot use Place of Power.`);
          s.stack.push({
            t: 'placeOfPower',
            player: hero.owner,
            hero: hero.id,
            terrain: terrain.id,
          });
        } else if (action.t === 'ability' && d.phase === 'hero') {
          declareAbility(ctx, action);
        } else if (
          action.t === 'ability' &&
          d.phase === 'end' &&
          action.abilityId === 'eruption-of-fury'
        ) {
          const unit = s.units[action.unit]!;
          const option = unitOptions(state, action.unit).find(
            (o) => o.t === 'ability' && o.abilityId === 'eruption-of-fury',
          );
          if (!option || option.t !== 'ability') {
            illegal(`${unit.name} cannot use Eruption of Fury now.`);
          }
          const targetId = action.target ?? option.targets[0];
          if (!targetId || !option.targets.includes(targetId)) {
            illegal('Eruption of Fury must target an enemy unit in combat with the unit.');
          }
          const profile = profileOf(scenario, unit);
          const melee = profile.weapons.find((w) => w.kind === 'melee');
          if (!melee) illegal('No melee weapon for Eruption of Fury.');
          const pState = s.players[unit.owner];
          resolveEruptionOfFury(
            ctx,
            unit,
            s.units[targetId]!,
            melee,
            Math.min(3, pState.rageDice ?? 0),
          );
        } else if (action.t === 'command') {
          if (d.phase === 'hero' && action.command === 'rally') {
            rally(ctx, action.unit);
          } else if (d.phase === 'hero' && action.command === 'magicalIntervention') {
            magicalIntervention(ctx, action.unit);
          } else if (d.phase === 'movement' && action.command === 'atTheDouble') {
            declareMove(ctx, action.unit, 'run', true);
          } else if (d.phase === 'movement' && action.command === 'redeploy') {
            redeploy(ctx, action.unit);
          } else if (d.phase === 'shooting' && action.command === 'coveringFire') {
            coveringFire(ctx, action.unit);
          } else if (d.phase === 'charge' && action.command === 'forwardToVictory') {
            forwardToVictory(ctx, action.unit);
          } else if (d.phase === 'charge' && action.command === 'counterCharge') {
            counterCharge(ctx, action.unit);
          } else if (d.phase === 'end' && action.command === 'powerThrough') {
            powerThrough(ctx, action.unit, action.target);
          } else {
            illegal(`Command "${action.command}" is not available in the ${d.phase} phase.`);
          }
        } else if (action.t === 'shoot' && d.phase === 'shooting') {
          declareShoot(ctx, action);
        } else if (action.t === 'charge' && d.phase === 'charge') {
          declareCharge(ctx, action.unit);
        } else {
          illegal(`Action "${action.t}" is not available in the ${d.phase} phase.`);
        }
        break;
      }
      case 'place':
        if (action.t === 'pass') {
          if (d.reason === 'deploy')
            illegal('Deployment placement is mandatory; pass is not allowed.');
          skipPlace(ctx);
        } else if (action.t === 'place') place(ctx, action.placement);
        else if (
          action.t === 'command' &&
          action.command === 'forwardToVictory' &&
          d.reason === 'charge' &&
          action.unit === d.unit
        ) {
          forwardToVictory(ctx, action.unit);
        } else illegal('Place the unit or leave it where it is.');
        break;
      case 'fightPick':
        if (action.t === 'fight') declareFight(ctx, d.player, action.unit);
        else if (action.t === 'pass' && d.canPass) {
          // Declines to attack faction terrain with every optional fighter of this tier.
          for (const u of eligibleFighters(scenario, s, d.player)) s.units[u.id]!.fought = true;
        } else illegal('Pick a unit to fight.');
        break;
      case 'targets':
        if (action.t !== 'targets') illegal('Choose targets for the weapons.');
        declareTargets(ctx, action);
        break;
      case 'reaction':
        answerReaction(ctx, action);
        break;
      case 'placeOfPower': {
        const frame = s.stack.pop();
        if (frame?.t !== 'placeOfPower') illegal('Not at Place of Power.');
        if (action.t === 'pass') {
          break;
        }
        if (action.t === 'choose') {
          const boon = action.value as PlaceOfPowerBoon;
          if (!['ignite_fury', 'channelled_wrath', 'dizzying_rage'].includes(boon)) {
            illegal('Invalid Place of Power boon.');
          }
          const hero = s.units[frame.hero]!;
          resolvePlaceOfPower(ctx, hero, boon);
          break;
        }
        illegal('Choose a Place of Power boon or pass.');
        break;
      }
      case 'alarielleSeason': {
        const frame = s.stack.pop();
        if (frame?.t !== 'alarielleSeason') illegal('Not choosing Alarielle season.');
        if (action.t !== 'choose') illegal('Choose a season of war.');
        const season = action.value;
        s.alarielleSeason = { ...(s.alarielleSeason ?? {}), [s.round]: season };
        ctx.events.push({
          t: 'note',
          text: `Alarielle proclaims the Season of War: ${season}.`,
        });
        break;
      }
    }
    settle(ctx);
    s.rng = ctx.rng.state;
    return { state: s, events: ctx.events };
  }

  // Set-up uses no dice, so it is computed once per engine and copied for each game.
  let deployed: UnitState[] | null = null;

  /** Quick start: the armies plus both armies' faction terrain, set up legally. */
  function withFactionTerrain(units: UnitState[]): UnitState[] {
    return [...units, ...placeFactionTerrain(scenario, units)].sort(
      (a, b) => a.owner - b.owner || a.armyIndex - b.armyIndex,
    );
  }

  function newGame(seed: number, options?: NewGameOptions): GameState {
    const isDeployMode = Boolean(options?.deploy);
    const unitsList = isDeployMode
      ? createReserveUnits(scenario)
      : (deployed ??= withFactionTerrain(deployArmies(scenario)));
    const units = unitsList.map((u) => ({ ...u, models: u.models.map((m) => ({ ...m })) }));
    const s: GameState = {
      seed,
      rng: rngFromSeed(seed),
      status: 'playing',
      round: 1,
      turnIndex: 0,
      active: 0,
      firstPlayer: 0,
      phase: 'hero',
      players: [
        { cp: 0, vp: 0, vpByRound: [], commandsUsed: [], spellsAttempted: [] },
        { cp: 0, vp: 0, vpByRound: [], commandsUsed: [], spellsAttempted: [] },
      ],
      units: Object.fromEntries(units.map((u) => [u.id, u])),
      unitOrder: units.map((u) => u.id),
      objectives: scenario.battlefield.objectives.map((o) => ({ id: o.id, controller: null })),
      stack: [],
      fightPicker: null,
      fightTier: null,
      winner: null,
      seizedBy: null,
      effects: [],
      banishedThisTurn: [],
      reactionsOffered: [],
    };
    initFury(s, 0);
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(s.rng) };
    if (isDeployMode) {
      s.stack = buildDeploymentFrames(scenario, s.units);
    } else {
      startRound(ctx);
    }
    s.rng = ctx.rng.state;
    return s;
  }

  function defaultAction(state: GameState): Action {
    const d = decision(state);
    if (!d) illegal('The game has ended.');
    switch (d.kind) {
      case 'priority':
        return { t: 'choose', value: 'first' };
      case 'placeOfPower':
        return { t: 'choose', value: 'ignite_fury' };
      case 'alarielleSeason':
        return { t: 'choose', value: d.seasons[0]! };
      case 'fugitive':
        return { t: 'choose', value: suggestFugitive(scenario, state, d.player) ?? d.units[0]! };
      case 'fightPick':
        if (d.canPass) return { t: 'pass' };
        return { t: 'fight', unit: eligibleFighters(scenario, state, d.player)[0]!.id };
      case 'place':
        if (d.reason === 'deploy') {
          return {
            t: 'place',
            placement: npcDeployPlacement(scenario, state, unitById(state, d.unit)),
          };
        }
        return { t: 'pass' };
      case 'targets':
        return {
          t: 'targets',
          allocations: targetOptions(state, d.unit, d.mode).map((w) => ({
            weaponId: w.weaponId,
            target: w.targets[0]!.unit,
          })),
        };
      default:
        return { t: 'pass' };
    }
  }

  return {
    scenario,
    newGame,
    decision,
    unitOptions,
    targetOptions,
    checkPlacement,
    apply,
    defaultAction,
  };
}
