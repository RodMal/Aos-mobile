/**
 * The baseline NPC: a small, readable rule-based opponent that plays a complete game.
 * Deterministic: the same state always gives the same action, and it never rolls dice.
 *
 * - Ranged units (more expected damage at range than in melee) head for objectives and shoot.
 * - Melee units close in on the nearest enemy when one is within reach, otherwise head for
 *   objectives, and charge when the roll needed is 7 or less.
 * - Wizards and Priests summon manifestations, banish enemy manifestations, cast spells and
 *   chant prayers, and unbind enemy spells.
 * - Weapons go to the target with the best expected damage; commands and reactions are used
 *   when enough CP are in hand.
 */
import {
  aliveIndices,
  controlScores,
  currentPlacement,
  enemiesInCombat,
  expectedDamage,
  opponent,
  profileOf,
  unitCentre,
  unitDistance,
  unitsOf,
  type Action,
  type Allocation,
  type AttackMode,
  type Decision,
  type Engine,
  type GameState,
  type PlayerId,
  type ReactionOption,
  type UnitOption,
  type UnitState,
} from '../engine/index.js';
import { diceMean } from '../data/profile.js';
import { npcDeployPlacement } from '../engine/deployment.js';
import { contestedObjective } from '../rules/core/objectives.js';
import { chargePlacement, moveTowards, pileInPlacement } from './placement.js';

/** CP the NPC keeps in hand before it spends on optional commands. */
const SPARE_CP = 2;
/** The NPC charges when the closest enemy is at most this far away (a 2D6 roll of 7). */
const CHARGE_GAP = 7.5;

export function chooseAction(engine: Engine, state: GameState): Action {
  const d = engine.decision(state);
  if (!d) throw new Error('The game has ended.');
  switch (d.kind) {
    case 'priority': {
      const me = state.players[d.player].vp;
      const them = state.players[opponent(d.player)].vp;
      return { t: 'choose', value: me < them ? 'second' : 'first' };
    }
    case 'reaction': {
      if (d.options.length === 0) return { t: 'pass' };
      const pain = d.options.find((o) => o.ability === 'fightThroughThePain');
      if (pain) return painAction(engine, state, pain);
      const unbindOpt = d.options.find((o) => o.ability === 'unbind');
      if (unbindOpt) {
        return { t: 'ability', unit: unbindOpt.unit, abilityId: 'unbind' };
      }
      const cp = state.players[d.player].cp;
      const affordable = d.options.filter((o) => o.command && cp >= Math.max(SPARE_CP, o.cost));
      if (affordable.length === 0) return { t: 'pass' };
      const best = [...affordable].sort(
        (a, b) => points(engine, state, b.unit) - points(engine, state, a.unit),
      )[0]!;
      return { t: 'command', command: best.command!, unit: best.unit };
    }
    case 'place':
      return placeAction(engine, state, d) ?? { t: 'pass' };
    case 'fightPick': {
      const units = unitsOf(state, d.player).filter((u) =>
        engine.unitOptions(state, u.id).some((o) => o.t === 'fight'),
      );
      const best = maxBy(units, (u) => bestAllocations(engine, state, u, 'fight').value);
      if (!best) return engine.defaultAction(state);
      return { t: 'fight', unit: best.id };
    }
    case 'targets': {
      const unit = state.units[d.unit]!;
      const { allocations, value } = bestAllocations(engine, state, unit, d.mode);
      const allOutAttack = allocations.length > 0 && value >= 2 && canAllOutAttack(state, unit);
      return { t: 'targets', allocations, ...(allOutAttack ? { allOutAttack } : {}) };
    }
    case 'placeOfPower': {
      const hero = state.units[d.hero]!;
      const profile = profileOf(engine.scenario, hero);
      const isCasterOrPriest = (profile.wizard ?? 0) > 0 || (profile.priest ?? 0) > 0;
      return { t: 'choose', value: isCasterOrPriest ? 'channelled_wrath' : 'ignite_fury' };
    }
    case 'alarielleSeason':
      return { t: 'choose', value: d.seasons[0]! };
    case 'fugitive':
      // The engine's default is the sensible pick: the enemy Hero easiest to slay.
      return engine.defaultAction(state);
    case 'main':
      return mainAction(engine, state, d.player, d.phase) ?? { t: 'pass' };
  }
}

/**
 * Eruption of Fury: the weapon and target with the most expected damage per attack (no crits);
 * every die it may spend, except one when the unit has 3 or fewer wounds left (each 1 rolled
 * costs it D3 mortal damage).
 */
export function eruptionAction(
  engine: Engine,
  state: GameState,
  unit: UnitState,
  option: Extract<UnitOption, { t: 'ability' }>,
): Action {
  const profile = profileOf(engine.scenario, unit);
  let best: { target: string; weaponId: string; value: number } | null = null;
  for (const w of profile.weapons.filter((x) => x.kind === 'melee')) {
    const noCrit = { ...w, abilities: w.abilities.filter((a) => !a.t.startsWith('crit')) };
    for (const id of option.targets) {
      const tp = profileOf(engine.scenario, state.units[id]!);
      const value = expectedDamage(noCrit, 1, { save: tp.save, ward: tp.ward ?? null }).total;
      if (!best || value > best.value) best = { target: id, weaponId: w.id, value };
    }
  }
  const max = option.maxRageDice ?? 1;
  const woundsLeft = profile.health * aliveIndices(unit).length - unit.damage;
  const rageDice = woundsLeft <= 3 ? 1 : max;
  return {
    t: 'ability',
    unit: unit.id,
    abilityId: 'eruption-of-fury',
    rageDice,
    ...(best ? { target: best.target, weaponId: best.weaponId } : {}),
  };
}

/**
 * Fight Through the Pain: spend rage dice only when the damage would slay a model (each die
 * lowers fury, so future rage), one die per point of damage up to what is held.
 */
export function painAction(engine: Engine, state: GameState, option: ReactionOption): Action {
  const unit = state.units[option.unit]!;
  const health = profileOf(engine.scenario, unit).health;
  const damage = option.damage ?? 0;
  if (unit.damage + damage < health) return { t: 'pass' };
  const rageDice = Math.min(option.maxRageDice ?? 0, damage);
  if (rageDice < 1) return { t: 'pass' };
  return { t: 'ability', unit: unit.id, abilityId: 'fight-through-the-pain', rageDice };
}

function points(engine: Engine, state: GameState, unitId: string): number {
  return profileOf(engine.scenario, state.units[unitId]!).points;
}

function maxBy<T>(items: readonly T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const v = score(item);
    if (v > bestScore) {
      best = item;
      bestScore = v;
    }
  }
  return best;
}

function canAllOutAttack(state: GameState, unit: UnitState): boolean {
  const p = state.players[unit.owner];
  return (
    !unit.isManifestation &&
    p.cp >= SPARE_CP &&
    !(p.commandsUsed ?? []).includes('allOutAttack') &&
    !unit.commandUsed
  );
}

/** Each weapon at the target with the best expected damage. */
function bestAllocations(
  engine: Engine,
  state: GameState,
  unit: UnitState,
  mode: AttackMode,
): { allocations: Allocation[]; value: number } {
  const allocations: Allocation[] = [];
  let value = 0;
  for (const w of engine.targetOptions(state, unit.id, mode)) {
    const best = maxBy(w.targets, (t) => t.expectedDamage)!;
    allocations.push({ weaponId: w.weaponId, target: best.unit });
    value += best.expectedDamage;
  }
  return { allocations, value };
}

/** Ranged units do more damage shooting than fighting (rough mean damage per turn). */
export function isRanged(engine: Engine, unit: UnitState): boolean {
  const weapons = profileOf(engine.scenario, unit).weapons;
  const output = (kind: 'melee' | 'ranged'): number =>
    weapons
      .filter((w) => w.kind === kind)
      .reduce((n, w) => n + diceMean(w.attacks) * diceMean(w.damage), 0);
  return output('ranged') > output('melee');
}

function nearestEnemy(
  engine: Engine,
  state: GameState,
  unit: UnitState,
): { enemy: UnitState; gap: number } | null {
  let best: { enemy: UnitState; gap: number } | null = null;
  for (const e of unitsOf(state, opponent(unit.owner))) {
    const gap = unitDistance(engine.scenario, unit, e);
    if (!best || gap < best.gap) best = { enemy: e, gap };
  }
  return best;
}

function contesting(engine: Engine, unit: UnitState): boolean {
  if (unit.isManifestation) return false;
  return aliveIndices(unit).some((i) => contestedObjective(engine.scenario, unit, i) !== null);
}

/**
 * Where the unit wants to go and how far: towards the nearest enemy (stopping just outside
 * 3") for a melee unit with an enemy within reach, otherwise to the nearest objective its
 * side does not control. Null to stay put.
 */
function destination(
  engine: Engine,
  state: GameState,
  unit: UnitState,
): { x: number; y: number; distance: number } | null {
  const profile = profileOf(engine.scenario, unit);
  const near = nearestEnemy(engine, state, unit);
  if (near && (!isRanged(engine, unit) || unit.isManifestation) && near.gap <= profile.move + 12) {
    const distance = near.gap - 3.5;
    return distance >= 0.5 ? { ...unitCentre(near.enemy), distance } : null;
  }
  if (unit.isManifestation || contesting(engine, unit)) return null;
  const c = unitCentre(unit);
  const scores = controlScores(engine.scenario, state);
  const wanted = engine.scenario.battlefield.objectives.filter((o) => {
    const controller = state.objectives.find((x) => x.id === o.id)!.controller;
    const [a, b] = scores.get(o.id)!;
    const mine = unit.owner === 0 ? a : b;
    return controller !== unit.owner || mine === 0;
  });
  const goal = maxBy(wanted, (o) => -Math.hypot(o.x - c.x, o.y - c.y));
  if (!goal) return null;
  const distance = Math.hypot(goal.x - c.x, goal.y - c.y) - goal.radius / 2;
  return distance >= 0.5 ? { x: goal.x, y: goal.y, distance } : null;
}

function placeAction(
  engine: Engine,
  state: GameState,
  d: Extract<Decision, { kind: 'place' }>,
): Action | null {
  const unit = state.units[d.unit]!;
  if (d.reason === 'deploy') {
    return { t: 'place', placement: npcDeployPlacement(engine.scenario, state, unit) };
  }
  if (d.reason === 'summon') {
    const cur = currentPlacement(unit);
    if (engine.checkPlacement(state, cur).length === 0) {
      return { t: 'place', placement: cur };
    }
    return null;
  }
  let placement = null;
  if (d.reason === 'charge') placement = chargePlacement(engine, state, d.unit);
  else if (d.reason === 'pileIn') placement = pileInPlacement(engine, state, d.unit);
  else if (d.reason === 'retreat' || d.reason === 'powerThrough') {
    const near = nearestEnemy(engine, state, unit);
    if (near) {
      const c = unitCentre(unit);
      const e = unitCentre(near.enemy);
      const len = Math.hypot(c.x - e.x, c.y - e.y) || 1;
      const away = { x: c.x + ((c.x - e.x) / len) * 20, y: c.y + ((c.y - e.y) / len) * 20 };
      placement = moveTowards(engine, state, d.unit, away);
    }
  } else {
    const goal = destination(engine, state, unit);
    if (goal) placement = moveTowards(engine, state, d.unit, goal, goal.distance);
  }
  return placement ? { t: 'place', placement } : null;
}

function chooseHeroAbilityAction(
  engine: Engine,
  state: GameState,
  units: UnitState[],
): Action | null {
  for (const unit of units) {
    const abilOpts = engine
      .unitOptions(state, unit.id)
      .filter((o): o is Extract<UnitOption, { t: 'ability' }> => o.t === 'ability');
    if (abilOpts.length === 0) continue;

    // 1. Banish enemy manifestations first
    const banish = abilOpts.find((o) => o.kind === 'banish');
    if (banish && banish.targets.length > 0) {
      return {
        t: 'ability',
        unit: unit.id,
        abilityId: banish.abilityId,
        target: banish.targets[0],
      };
    }

    // 2. Summon manifestations
    const summon = abilOpts.find((o) => o.kind === 'summon');
    if (summon) {
      return {
        t: 'ability',
        unit: unit.id,
        abilityId: summon.abilityId,
      };
    }

    // 3. Place of Power
    const pop = abilOpts.find((o) => o.abilityId === 'place-of-power');
    if (pop) {
      return { t: 'ability', unit: unit.id, abilityId: 'place-of-power' };
    }

    // 3. Spells & Prayers: pick highest-points target that doesn't already have this effect
    for (const opt of abilOpts) {
      if (opt.kind !== 'spell' && opt.kind !== 'prayer') continue;
      const unbuffedTargets = opt.targets.filter(
        (tid) => !(state.effects ?? []).some((e) => e.id === opt.abilityId && e.targetUnit === tid),
      );
      const candidates = unbuffedTargets.length > 0 ? unbuffedTargets : opt.targets;
      if (candidates.length === 0) continue;
      const bestTarget = maxBy(candidates, (tid) => points(engine, state, tid))!;
      return {
        t: 'ability',
        unit: unit.id,
        abilityId: opt.abilityId,
        target: bestTarget,
      };
    }
  }
  return null;
}

function mainAction(
  engine: Engine,
  state: GameState,
  player: PlayerId,
  phase: GameState['phase'],
): Action | null {
  const units = unitsOf(state, player);
  const cp = state.players[player].cp;
  switch (phase) {
    case 'hero': {
      const abilityAct = chooseHeroAbilityAction(engine, state, units);
      if (abilityAct) return abilityAct;
      if (cp < SPARE_CP) return null;
      const hurt = units.filter((u) =>
        engine.unitOptions(state, u.id).some((o) => o.t === 'command' && o.command === 'rally'),
      );
      const lost = (u: UnitState): number =>
        u.damage + u.models.filter((m) => !m.alive).length * profileOf(engine.scenario, u).health;
      const best = maxBy(hurt, lost);
      return best && lost(best) >= 2 ? { t: 'command', command: 'rally', unit: best.id } : null;
    }
    case 'movement':
      for (const unit of units) {
        const action = movementAction(engine, state, unit);
        if (action) return action;
      }
      return null;
    case 'shooting':
      for (const unit of units) {
        if (!engine.unitOptions(state, unit.id).some((o) => o.t === 'shoot')) continue;
        const { allocations, value } = bestAllocations(engine, state, unit, 'shoot');
        if (allocations.length === 0) continue;
        const allOutAttack = value >= 2 && canAllOutAttack(state, unit);
        return {
          t: 'shoot',
          unit: unit.id,
          allocations,
          ...(allOutAttack ? { allOutAttack } : {}),
        };
      }
      return null;
    case 'charge':
      for (const unit of units) {
        if (!engine.unitOptions(state, unit.id).some((o) => o.t === 'charge')) continue;
        if (isRanged(engine, unit) && !unit.isManifestation) continue;
        const near = nearestEnemy(engine, state, unit);
        if (near && near.gap <= CHARGE_GAP) return { t: 'charge', unit: unit.id };
      }
      return null;
    case 'end': {
      for (const unit of units) {
        const eruption = engine
          .unitOptions(state, unit.id)
          .find((o) => o.t === 'ability' && o.abilityId === 'eruption-of-fury');
        if (eruption && eruption.t === 'ability') {
          return eruptionAction(engine, state, unit, eruption);
        }
      }
      if (cp < SPARE_CP) return null;
      for (const unit of units) {
        const pt = engine
          .unitOptions(state, unit.id)
          .find((o) => o.t === 'command' && o.command === 'powerThrough');
        if (pt && pt.t === 'command' && pt.targets && pt.targets.length > 0) {
          return {
            t: 'command',
            command: 'powerThrough',
            unit: unit.id,
            target: pt.targets[0],
          };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * A move for this unit, or null to leave it. A normal move is declared only once a legal
 * placement for it is known, so the NPC never declares a move it then has to cancel.
 */
function movementAction(engine: Engine, state: GameState, unit: UnitState): Action | null {
  const options = engine.unitOptions(state, unit.id);
  if (options.some((o) => o.t === 'move' && o.kind === 'retreat')) {
    const weak = bestAllocations(engine, state, unit, 'fight').value < 1;
    const enemies = enemiesInCombat(engine.scenario, state, unit);
    if (!weak || enemies.length === 0 || contesting(engine, unit)) return null;
    const retreat: Action = { t: 'move', unit: unit.id, kind: 'retreat' };
    const declared = engine.apply(state, retreat).state;
    const d = engine.decision(declared);
    return d?.kind === 'place' && placeAction(engine, declared, d) ? retreat : null;
  }
  if (!options.some((o) => o.t === 'move' && o.kind === 'normal')) return null;
  const goal = destination(engine, state, unit);
  if (!goal) return null;
  const move = profileOf(engine.scenario, unit).move;
  // Run when the goal is beyond a normal move and the unit will not charge this turn.
  if (
    goal.distance > move + 2 &&
    !isRanged(engine, unit) &&
    options.some((o) => o.t === 'move' && o.kind === 'run')
  ) {
    const near = nearestEnemy(engine, state, unit);
    if (!near || near.gap > move + CHARGE_GAP) return { t: 'move', unit: unit.id, kind: 'run' };
  }
  const declared = engine.apply(state, { t: 'move', unit: unit.id, kind: 'normal' }).state;
  return moveTowards(engine, declared, unit.id, goal, goal.distance)
    ? { t: 'move', unit: unit.id, kind: 'normal' }
    : null;
}
