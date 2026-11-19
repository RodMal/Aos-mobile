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
  ARK_OF_SOTEK_ID,
  ARMOUR_CRUNCHER_ID,
  CELESTIAL_CONDUIT_ID,
  COATL_FAMILIAR_ID,
  SCRY_THE_STARS_ID,
  STAR_VENOM_ID,
  VENOMITE_SWARM_ID,
  aliveIndices,
  controlScores,
  currentPlacement,
  enemiesInCombat,
  expectedDamage,
  npcGlamourweaveReroll,
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
import {
  GROUNDSHAKER_ID,
  LIFEBLOOM_ID,
  LIVING_BATTERING_RAM_ID,
  WYLDWOOD_REVENANTS_ID,
} from '../engine/abilities/sylvaneth.js';
import { npcAsterism } from '../rules/factions/seraphon.js';
import { npcCreepingDreadTargets, npcSeason } from '../rules/factions/seasons.js';

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
      // Glamourweave: spend the re-roll on the failed roll of the attack with the most potential
      // damage (keep it while a better attack is still to be rolled); the same every time.
      const glamour = d.options.find((o) => o.ability === 'glamourweave');
      if (glamour) {
        return npcGlamourweaveReroll(engine.scenario, state, glamour)
          ? { t: 'ability', unit: glamour.unit, abilityId: 'glamourweave' }
          : { t: 'pass' };
      }
      const pain = d.options.find((o) => o.ability === 'fightThroughThePain');
      if (pain) return painAction(engine, state, pain);
      // Celestial Conduit and Coatl Familiar cost nothing and only help the spell: always used.
      const boost = d.options.find(
        (o) => o.ability === 'celestialConduit' || o.ability === 'coatlFamiliar',
      );
      if (boost) {
        return {
          t: 'ability',
          unit: boost.unit,
          abilityId:
            boost.ability === 'celestialConduit' ? CELESTIAL_CONDUIT_ID : COATL_FAMILIAR_ID,
        };
      }
      // Wyldwood Revenants re-rolls a chanting roll of 1: always used.
      const revenants = d.options.find((o) => o.ability === 'wyldwoodRevenants');
      if (revenants) {
        return { t: 'ability', unit: revenants.unit, abilityId: WYLDWOOD_REVENANTS_ID };
      }
      const unbindOpt = d.options.find((o) => o.ability === 'unbind');
      if (unbindOpt) {
        return { t: 'ability', unit: unbindOpt.unit, abilityId: 'unbind' };
      }
      const cp = state.players[d.player].cp;
      // Redeploy is offered once, at the end of the enemy movement phase: only worth it for a
      // unit with an enemy within 9" (it then counts as having run).
      const worthIt = (o: ReactionOption) =>
        o.command !== 'redeploy' ||
        unitsOf(state, opponent(d.player)).some(
          (e) => unitDistance(engine.scenario, e, state.units[o.unit]!) <= 9,
        );
      const affordable = d.options.filter(
        (o) => o.command && cp >= Math.max(SPARE_CP, o.cost) && worthIt(o),
      );
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
      const ability = seraphonCombatAction(engine, state, d.player);
      if (ability) return ability;
      const groundshaker = ownAbilityAction(engine, state, d.player, GROUNDSHAKER_ID);
      if (groundshaker) return groundshaker;
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
      // Channelled Wrath only helps a Wizard or Priest in its own turn (casting and chanting
      // happen in your hero phase); otherwise Ignite Fury, which always helps the army.
      const isCasterOrPriest = (profile.wizard ?? 0) > 0 || (profile.priest ?? 0) > 0;
      const ownTurn = state.active === d.player;
      return {
        t: 'choose',
        value: isCasterOrPriest && ownTurn ? 'channelled_wrath' : 'ignite_fury',
      };
    }
    case 'alarielleSeason': {
      const pick = npcSeason(engine.scenario, state, d.player);
      return { t: 'choose', value: d.seasons.includes(pick) ? pick : d.seasons[0]! };
    }
    case 'creepingDread': {
      const ids = npcCreepingDreadTargets(engine.scenario, state, d.units, d.max);
      return ids.length > 0 ? { t: 'choose', value: ids.join(',') } : { t: 'pass' };
    }
    case 'prayer':
      // Always answer: a prayer that is answered now beats points that may be lost to a 1 later.
      return { t: 'choose', value: 'use' };
    case 'asterism': {
      const pick = npcAsterism(engine.scenario, state, d.player, d.stage);
      return pick
        ? { t: 'choose', value: pick.key ? `${pick.key},${pick.id}` : pick.id }
        : { t: 'pass' };
    }
    case 'vengeance': {
      // Always worth it (a free pile-in and mortal damage): every unit offered, up to the
      // maximum, in list order; against the enemy worth the most points (the first on a tie).
      if (d.stage === 'pick') {
        return d.units.length > 0
          ? { t: 'choose', value: `vengeance:${d.units.slice(0, d.max).join(',')}` }
          : { t: 'choose', value: 'none' };
      }
      const foe = maxBy(d.units, (id) => points(engine, state, id));
      return { t: 'choose', value: foe ?? d.units[0]! };
    }
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

/**
 * Venomite Swarm, Ark of Sotek and Armour Cruncher while a fighter is picked: each is once per
 * turn (or needs a rage dice), so using them first never loops. The target worth the most
 * points; the Ark takes as many as it may.
 */
function seraphonCombatAction(engine: Engine, state: GameState, player: PlayerId): Action | null {
  for (const unit of unitsOf(state, player)) {
    for (const o of engine.unitOptions(state, unit.id)) {
      if (o.t !== 'ability' || o.targets.length === 0) continue;
      const known = [VENOMITE_SWARM_ID, ARK_OF_SOTEK_ID, ARMOUR_CRUNCHER_ID];
      if (!known.some((id) => o.abilityId.startsWith(id))) continue;
      const ranked = [...o.targets].sort(
        (a, b) => points(engine, state, b) - points(engine, state, a),
      );
      return o.abilityId === ARK_OF_SOTEK_ID
        ? {
            t: 'ability',
            unit: unit.id,
            abilityId: o.abilityId,
            targets: ranked.slice(0, o.maxTargets ?? 1),
          }
        : { t: 'ability', unit: unit.id, abilityId: o.abilityId, target: ranked[0]! };
    }
  }
  return null;
}

/**
 * A once-per-turn ability of one of `player`'s units (Lifebloom, Living Battering Ram,
 * Groundshaker), against the target worth the most points when it has targets.
 */
function ownAbilityAction(
  engine: Engine,
  state: GameState,
  player: PlayerId,
  abilityId: string,
): Action | null {
  for (const unit of unitsOf(state, player)) {
    const o = engine
      .unitOptions(state, unit.id)
      .find((x) => x.t === 'ability' && x.abilityId === abilityId);
    if (!o || o.t !== 'ability') continue;
    if (o.targets.length === 0) return { t: 'ability', unit: unit.id, abilityId };
    const best = maxBy(o.targets, (id) => points(engine, state, id))!;
    return { t: 'ability', unit: unit.id, abilityId, target: best };
  }
  return null;
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
    const placement = npcDeployPlacement(engine.scenario, state, unit);
    return placement ? { t: 'place', placement } : null;
  }
  if (d.reason === 'setUp') {
    // A further Awakened Wyldwood starts at a legal spot near an objective: keep it there.
    return { t: 'place', placement: currentPlacement(unit) };
  }
  // The NPC never uses the replacement commands; if one is pending, take it back.
  if (d.reason === 'replacement' || d.reason === 'relocate') return { t: 'pass' };
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

    // Scry the Stars (once a battle): from round 2, when it rolls at least two dice. The
    // units it may protect, the most valuable first.
    const scry = abilOpts.find((o) => o.abilityId === SCRY_THE_STARS_ID);
    if (scry && state.round >= 2 && scry.targets.length > 0) {
      const ranked = [...scry.targets].sort(
        (a, b) => points(engine, state, b) - points(engine, state, a),
      );
      return {
        t: 'ability',
        unit: unit.id,
        abilityId: scry.abilityId,
        targets: ranked.slice(0, scry.maxTargets ?? 1),
      };
    }

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

    // 2. A spell that hits several enemies (Enrage The Spites): up to its maximum targets.
    const multi = abilOpts.find(
      (o) => o.kind === 'spell' && (o.maxTargets ?? 1) > 1 && o.targets.length > 0,
    );
    if (multi) {
      const opt = multi;
      // Up to the maximum: a unit D3 mortal damage could finish off first, then by points.
      const score = (tid: string) => {
        const u = state.units[tid]!;
        const lastModel = u.models.filter((m) => m.alive).length === 1;
        const left = profileOf(engine.scenario, u).health - u.damage;
        return (lastModel && left <= 2 ? 1000 : 0) + points(engine, state, tid);
      };
      const ranked = [...opt.targets].sort((x, y) => score(y) - score(x));
      return {
        t: 'ability',
        unit: unit.id,
        abilityId: opt.abilityId,
        targets: ranked.slice(0, opt.maxTargets ?? 1),
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

    // 3. Further Awakened Wyldwood (set up at the suggested spot)
    if (abilOpts.some((o) => o.abilityId === 'awakened-wyldwood-setup')) {
      return { t: 'ability', unit: unit.id, abilityId: 'awakened-wyldwood-setup' };
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
      // Lifebloom heals Alarielle for 2D6 whenever she is hurt.
      const lifebloom = ownAbilityAction(engine, state, player, LIFEBLOOM_ID);
      if (lifebloom) return lifebloom;
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
        // Star-venom, once the Dartpipe has done damage.
        const venom = engine
          .unitOptions(state, unit.id)
          .find((o) => o.t === 'ability' && o.abilityId === STAR_VENOM_ID);
        if (venom && venom.t === 'ability' && venom.targets.length > 0) {
          return {
            t: 'ability',
            unit: unit.id,
            abilityId: STAR_VENOM_ID,
            target: venom.targets[0],
          };
        }
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
      {
        const ram = ownAbilityAction(engine, state, player, LIVING_BATTERING_RAM_ID);
        if (ram) return ram;
      }
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
