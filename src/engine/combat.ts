/**
 * Shooting and fighting: which weapons can attack which targets, and resolving the attacks
 * of one unit. Range is measured base edge to base edge from each model, and only models in
 * range of the chosen target attack. Line of sight comes in M3.
 */
import { attackModifiers, sumModifiers } from '../rules/core/modifiers.js';
import {
  abilityWeapon,
  clearExpiredEffects,
  effectiveWard,
  unitGrants,
  wardRollModifier,
} from './abilities/effects.js';
import { recordDartpipeDamage } from './abilities/seraphon.js';
import { RerollNeeded } from './attack.js';
import { applyStarspawned } from './starspawned.js';
import { glamourRerolls, spendGlamourweave } from './abilities/sylvaneth.js';
import { hasAbility, rollAttackCount, rollAttackSequence, rollWard } from './attack.js';
import { illegal, type Ctx } from './ctx.js';
import { allocateDamage, runMortalFollowUp } from './damage.js';
import { expectedAttacks, expectedDamage, type AttackMods } from './expected.js';
import {
  COMBAT_RANGE,
  enemiesWithin,
  inCombat,
  modelsWithinRangeOf,
  profileOf,
  unitBounds,
  unitsOf,
  opponent,
} from './query.js';
import { effectiveWeaponRange, isGuardedHero, isUnitVisible } from './terrain.js';
import type { Weapon } from '../data/profile.js';
import { asterismWeapon } from '../rules/factions/seraphon.js';
import type {
  Allocation,
  AttackMode,
  Frame,
  ReactionOption,
  UnitId,
  GameState,
  Scenario,
  UnitState,
  WeaponTargets,
} from './types.js';

/** The weapon as `unit` uses it now: Asterism and Battle Damaged changes applied. */
export function usedWeapon(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  weapon: Weapon,
): Weapon {
  return abilityWeapon(scenario, state, unit, asterismWeapon(scenario, state, unit, weapon));
}

/** True when the unit may shoot this turn at all (weapons and targets aside). */
export function mayShoot(unit: UnitState, runAndShoot = false): boolean {
  return (
    unit.status === 'battlefield' &&
    !unit.shot &&
    (unit.moved !== 'run' || runAndShoot) &&
    unit.moved !== 'retreat'
  );
}

/**
 * Model indices that carry `weapon`, or null when every model does. An army list entry can
 * say how many models carry each weapon where the warscroll offers a choice (`weapons`):
 * the named weapons go to the first models by index, in the order listed, and the other
 * weapons of the same kind go to the rest.
 */
export function weaponCarriers(
  scenario: Scenario,
  unit: UnitState,
  weapon: Weapon,
): Set<number> | null {
  if (unit.isManifestation) return null;
  const loadout = scenario.armies[unit.owner].list.units[unit.armyIndex]?.weapons;
  if (!loadout) return null;
  const profile = profileOf(scenario, unit);
  const named = profile.weapons.filter((w) => loadout[w.name] !== undefined);
  if (!named.some((w) => w.kind === weapon.kind)) return null;
  const carriers = new Map<string, Set<number>>();
  let next = 0;
  for (const w of named) {
    const set = new Set<number>();
    for (let k = 0; k < loadout[w.name]! && next < profile.models.length; k++) set.add(next++);
    carriers.set(w.id, set);
  }
  const own = carriers.get(weapon.id);
  if (own) return own;
  const rest = new Set<number>();
  for (let i = next; i < profile.models.length; i++) rest.add(i);
  return rest;
}

/** Living models of `attacker` that carry `weapon` and are within `range` of `target`. */
function attackingModels(
  scenario: Scenario,
  attacker: UnitState,
  target: UnitState,
  weapon: Weapon,
  range: number,
): number[] {
  const indices = modelsWithinRangeOf(scenario, attacker, target, range);
  const carriers = weaponCarriers(scenario, attacker, weapon);
  return carriers ? indices.filter((i) => carriers.has(i)) : indices;
}

function championsAmong(scenario: Scenario, unit: UnitState, indices: number[]): number {
  const models = profileOf(scenario, unit).models;
  return indices.filter((i) => models[i]!.champion).length;
}

/** Modifiers for one weapon attacking one target, capped. */
export function weaponMods(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  target: UnitState,
  weapon: Weapon,
  mode: AttackMode,
  extra: { allOutAttack?: boolean; allOutDefence?: boolean; coveringFire?: boolean } = {},
): AttackMods {
  const targetGrants = unitGrants(scenario, state, target);
  return sumModifiers(
    attackModifiers(scenario, state, { attacker, target, weapon, mode, ...extra }),
    weapon,
    { ignoreSaveModifiers: targetGrants.ignoreSaveModifiers },
  );
}

/** Expected damage of `indices` models of `attacker` using `weapon` on `target`. */
export function expectedWeaponDamage(
  scenario: Scenario,
  state: GameState,
  attacker: UnitState,
  target: UnitState,
  weapon: Weapon,
  mode: AttackMode,
  indices: number[],
  extra: { allOutAttack?: boolean; allOutDefence?: boolean; coveringFire?: boolean } = {},
): number {
  const tp = profileOf(scenario, target);
  const ward = effectiveWard(scenario, state, target) ?? null;
  const attacks = expectedAttacks(
    weapon,
    indices.length,
    championsAmong(scenario, attacker, indices),
  );
  const mods = weaponMods(scenario, state, attacker, target, weapon, mode, extra);
  return expectedDamage(weapon, attacks, { save: tp.save, ward }, mods).total;
}

/**
 * Weapons that can attack now and their legal targets. Shooting: ranged weapons (only
 * Shoot in Combat ones while the unit is in combat), for a unit that has not shot, run or
 * retreated. Fighting: melee weapons against enemy units within 3". Weapons without a
 * target are left out.
 */
export function weaponTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  mode: AttackMode,
): WeaponTargets[] {
  if (unit.status !== 'battlefield') return [];
  const profile = profileOf(scenario, unit);
  let weapons: Weapon[];
  let candidates: UnitState[];
  if (mode === 'shoot') {
    const grants = unitGrants(scenario, state, unit);
    if (!mayShoot(unit, grants.runAndShoot)) return [];
    const engaged = inCombat(scenario, state, unit);
    weapons = profile.weapons
      .filter((w) => w.kind === 'ranged' && (!engaged || hasAbility(w, 'shootInCombat')))
      .map((w) => usedWeapon(scenario, state, unit, w));
    if (weapons.length === 0) return [];
    const maxRange = Math.max(
      ...weapons.map((w) => effectiveWeaponRange(scenario, state, unit, w.range)),
    );
    const own = unitBounds(scenario, unit);
    candidates = unitsOf(state, opponent(unit.owner)).filter((e) => {
      // Faction terrain is a unit only in the combat phase (owner's ruling).
      if (profileOf(scenario, e).isFactionTerrain) return false;
      if (!isUnitVisible(scenario, state, unit, e)) return false;
      const b = unitBounds(scenario, e);
      return Math.hypot(b.x - own.x, b.y - own.y) - b.r - own.r <= maxRange + 1e-6;
    });
  } else {
    weapons = profile.weapons
      .filter((w) => w.kind === 'melee')
      .map((w) => usedWeapon(scenario, state, unit, w));
    if (weapons.length === 0) return [];
    // Units within 3" of enemy faction terrain may attack it.
    candidates = enemiesWithin(scenario, state, unit, COMBAT_RANGE, true);
  }
  const out: WeaponTargets[] = [];
  for (const weapon of weapons) {
    const range = mode === 'shoot' ? weapon.range : COMBAT_RANGE;
    const targets: WeaponTargets['targets'] = [];
    for (const target of candidates) {
      let allowedRange = range;
      if (mode === 'shoot') {
        allowedRange = effectiveWeaponRange(scenario, state, unit, weapon.range);
        if (isGuardedHero(scenario, state, target).infantry) {
          allowedRange = Math.min(allowedRange, 12);
        }
      }
      const indices = attackingModels(scenario, unit, target, weapon, allowedRange);
      if (indices.length === 0) continue;
      targets.push({
        unit: target.id,
        modelsInRange: indices.length,
        expectedDamage: expectedWeaponDamage(scenario, state, unit, target, weapon, mode, indices),
      });
    }
    if (targets.length > 0) out.push({ weaponId: weapon.id, weaponName: weapon.name, targets });
  }
  return out;
}

/** Throws unless every allocation names an offered weapon (once) and one of its targets. */
export function checkAllocations(options: WeaponTargets[], allocations: Allocation[]): void {
  const used = new Set<string>();
  for (const a of allocations) {
    const option = options.find((o) => o.weaponId === a.weaponId);
    if (!option) illegal('That weapon cannot attack now.');
    if (used.has(a.weaponId)) illegal('Each weapon attacks one target.');
    used.add(a.weaponId);
    if (!option.targets.some((t) => t.unit === a.target)) {
      illegal(`${option.weaponName} cannot reach that target.`);
    }
  }
}

/**
 * The expected damage of each allocation of a `resolve` frame from the one being rolled
 * (`frame.at`) onward, in order (0 for one that cannot attack). The NPC compares these to decide
 * which failed roll a Glamourweave re-roll is worth spending on.
 */
export function pendingAttackDamage(
  scenario: Scenario,
  s: GameState,
  frame: Extract<Frame, { t: 'resolve' }>,
): { target: UnitId; damage: number }[] {
  const attacker = s.units[frame.unit]!;
  const profile = profileOf(scenario, attacker);
  const out: { target: UnitId; damage: number }[] = [];
  for (let at = frame.at ?? 0; at < frame.allocations.length; at++) {
    const alloc = frame.allocations[at]!;
    const target = s.units[alloc.target]!;
    const base = profile.weapons.find((w) => w.id === alloc.weaponId);
    let damage = 0;
    if (base && target.status === 'battlefield') {
      const weapon = usedWeapon(scenario, s, attacker, base);
      let range = frame.mode === 'shoot' ? weapon.range : COMBAT_RANGE;
      if (frame.mode === 'shoot') {
        range = effectiveWeaponRange(scenario, s, attacker, weapon.range);
        if (isGuardedHero(scenario, s, target).infantry) range = Math.min(range, 12);
      }
      const indices = attackingModels(scenario, attacker, target, weapon, range);
      if (indices.length > 0) {
        damage = expectedWeaponDamage(scenario, s, attacker, target, weapon, frame.mode, indices, {
          allOutAttack: frame.allOutAttack,
          allOutDefence: frame.defended.includes(target.id),
          coveringFire: frame.coveringFire,
        });
      }
    }
    out.push({ target: alloc.target, damage });
  }
  return out;
}

/**
 * The NPC's answer to a Glamourweave question: re-roll this failed roll only when its attack has
 * the most potential damage (expected damage) among the attacks still to be rolled in this
 * phase's attack that the same re-roll could be spent on (ties go to the earlier one), else keep
 * it for the better one. A save re-roll counts only the attacks on the unit that holds it.
 */
export function npcGlamourweaveReroll(
  scenario: Scenario,
  s: GameState,
  option: ReactionOption,
): boolean {
  const reroll = option.reroll;
  const frame = s.stack[s.stack.length - 2];
  if (!reroll || frame?.t !== 'resolve') return true;
  const pending = pendingAttackDamage(scenario, s, frame);
  const comparable = pending.filter((p) => reroll.kind !== 'save' || p.target === option.unit);
  const here = pending[0]?.damage ?? 0;
  return comparable.every((p) => p.damage <= here);
}

/**
 * Rolls every allocated weapon's attacks, then allocates the damage to each target.
 *
 * A Glamourweave re-roll is the player's choice: at a failed roll the owner is asked (a
 * `reaction` frame, the attacks waiting under it as a `resolve` frame that remembers its
 * progress). The allocation is then rolled again from the same dice with the answers so far, so
 * nothing is applied until it has run through.
 */
export function resolveAttacks(ctx: Ctx, frame: Extract<Frame, { t: 'resolve' }>): void {
  const { scenario, s } = ctx;
  const attacker = s.units[frame.unit]!;
  if (attacker.status !== 'battlefield') return;
  const profile = profileOf(scenario, attacker);
  const pending = new Map<string, number>((frame.pending ?? []).map((p) => [p.target, p.amount]));
  for (let at = frame.at ?? 0; at < frame.allocations.length; at++) {
    const alloc = frame.allocations[at]!;
    const choices = at === (frame.at ?? 0) ? (frame.choices ?? []) : [];
    const weapon = usedWeapon(
      scenario,
      s,
      attacker,
      profile.weapons.find((w) => w.id === alloc.weaponId)!,
    );
    const target = s.units[alloc.target]!;
    if (target.status !== 'battlefield') continue;
    let allowedRange = frame.mode === 'shoot' ? weapon.range : COMBAT_RANGE;
    if (frame.mode === 'shoot') {
      allowedRange = effectiveWeaponRange(scenario, s, attacker, weapon.range);
      if (isGuardedHero(scenario, s, target).infantry) {
        allowedRange = Math.min(allowedRange, 12);
      }
    }
    const indices = attackingModels(scenario, attacker, target, weapon, allowedRange);
    if (indices.length === 0) continue;
    const tp = profileOf(scenario, target);
    const targetWard = effectiveWard(scenario, s, target) ?? null;
    const start = ctx.rng.state;
    const attacks = rollAttackCount(
      ctx.rng,
      weapon,
      indices.length,
      championsAmong(scenario, attacker, indices),
    );
    const mods = weaponMods(scenario, s, attacker, target, weapon, frame.mode, {
      allOutAttack: frame.allOutAttack,
      allOutDefence: frame.defended.includes(target.id),
      coveringFire: frame.coveringFire,
    });
    let answered = 0;
    let roll: ReturnType<typeof rollAttackSequence>;
    try {
      roll = rollAttackSequence(ctx.rng, {
        weapon,
        attacks,
        mods,
        target: { save: tp.save, ward: targetWard },
        rerolls: glamourRerolls(scenario, s, attacker, target),
        chooseReroll: (kind, die) => {
          if (answered < choices.length) return choices[answered++]!;
          throw new RerollNeeded(kind, die);
        },
      });
    } catch (e) {
      if (!(e instanceof RerollNeeded)) throw e;
      // Ask the owner of the re-roll; the allocation is rolled again from `start` afterwards.
      ctx.rng.state = start;
      const holder = e.kind === 'save' ? target : attacker;
      s.stack.push({
        ...frame,
        at,
        pending: [...pending].map(([t, amount]) => ({ target: t, amount })),
        choices,
      });
      s.stack.push({
        t: 'reaction',
        player: holder.owner,
        options: [
          {
            ability: 'glamourweave',
            unit: holder.id,
            cost: 0,
            reroll: { kind: e.kind, die: e.die, weapon: weapon.name, target: target.id },
          },
        ],
        trigger: `reroll:${holder.id}:${e.kind}`,
      });
      return;
    }
    const spent = roll.rerolled;
    if (spent.hit || spent.wound || spent.save) {
      spendGlamourweave(s, attacker, target, spent);
      const kinds = (['hit', 'wound', 'save'] as const).filter((k) => spent[k]);
      ctx.events.push({
        t: 'note',
        text: `Glamourweave: re-rolled a failed ${kinds.join(', ')} roll.`,
      });
    }
    const ward = rollWard(
      ctx.rng,
      roll.damage + roll.mortal,
      targetWard,
      wardRollModifier(scenario, s, target),
    );
    ctx.events.push({
      t: 'attacks',
      attacker: attacker.id,
      target: target.id,
      weapon: weapon.name,
      mode: frame.mode,
      attacks: roll.attacks,
      hits: roll.hits,
      crits: roll.crits,
      wounds: roll.wounds,
      unsaved: roll.unsaved,
      mortal: roll.mortal,
      damage: ward.taken,
      warded: roll.damage + roll.mortal - ward.taken,
      dice: { ...roll.dice, ward: ward.dice },
    });
    pending.set(target.id, (pending.get(target.id) ?? 0) + ward.taken);
    if (ward.taken > 0 && frame.mode === 'shoot') {
      recordDartpipeDamage(scenario, s, attacker, weapon, target);
    }
  }
  clearExpiredEffects(s, 'attack');
  allocatePending(ctx, {
    t: 'allocate',
    attacker: attacker.id,
    mode: frame.mode,
    pending: [...pending].map(([target, amount]) => ({ target, amount })),
  });
}

/** Fight Through the Pain's ability ID in `ability` actions. */
export const FIGHT_THROUGH_THE_PAIN_ID = 'fight-through-the-pain';

/**
 * Allocates rolled attack damage target by target. Before damage is allocated to a unit whose
 * owner holds rage dice, the owner is asked whether to use Fight Through the Pain: the frame
 * goes back on the stack under a `reaction`, and `allocateOne` continues once it is answered.
 */
export function allocatePending(ctx: Ctx, frame: Extract<Frame, { t: 'allocate' }>): void {
  const { s } = ctx;
  while (frame.pending.length > 0) {
    const { target: id } = frame.pending[0]!;
    let amount = frame.pending[0]!.amount;
    const target = s.units[id]!;
    // Starspawned comes off before Fight Through the Pain is offered (the prompt shows what is
    // really allocated); the effect is then spent, so `allocateDamage` does not apply it again.
    const reduced = applyStarspawned(ctx, target, amount);
    if (reduced !== amount) {
      amount = reduced;
      frame.pending = [{ ...frame.pending[0]!, amount }, ...frame.pending.slice(1)];
    }
    const rage = s.players[target.owner].rageDice ?? 0;
    // Faction terrain never acts or is acted for (owner's ruling): no Fight Through the Pain.
    const terrain = profileOf(ctx.scenario, target).isFactionTerrain;
    if (amount > 0 && rage > 0 && target.status === 'battlefield' && !terrain) {
      s.stack.push(frame);
      s.stack.push({
        t: 'reaction',
        player: target.owner,
        options: [
          {
            ability: 'fightThroughThePain',
            unit: id,
            cost: 0,
            damage: amount,
            maxRageDice: rage,
          },
        ],
        trigger: `pain:${id}:${amount}`,
      });
      return;
    }
    allocateOne(ctx, frame, amount);
  }
}

/** Allocates `amount` to the first pending target and removes it from the frame. */
export function allocateOne(
  ctx: Ctx,
  frame: Extract<Frame, { t: 'allocate' }>,
  amount: number,
): void {
  const { s } = ctx;
  // The frame may share its array with an earlier state (states are copied shallowly), so
  // replace it instead of shifting it.
  const { target: id, source: named, followUp } = frame.pending[0]!;
  frame.pending = frame.pending.slice(1);
  const attacker = s.units[frame.attacker]!;
  const res = allocateDamage(
    ctx,
    s.units[id]!,
    amount,
    named ?? `${attacker.name} (${frame.mode})`,
  );
  if (!named && res.destroyed && frame.mode === 'fight' && attacker.charged) {
    s.destroyedByChargeCombat = [...(s.destroyedByChargeCombat ?? []), id];
  }
  if (followUp) runMortalFollowUp(ctx, followUp, res.destroyed);
}

/**
 * Allocates the mortal damage queued by `inflictMortalDamage`, asking each target's owner about
 * Fight Through the Pain first (the same prompt as for attack damage). A no-op when none is queued.
 */
export function flushMortalDamage(ctx: Ctx): void {
  const queued = ctx.s.pendingMortal;
  if (!queued || queued.length === 0) return;
  ctx.s.pendingMortal = [];
  // One prompt per unit: its queued entries are added up (sources named once each).
  const merged: typeof queued = [];
  for (const q of queued) {
    const same = merged.find((m) => m.target === q.target);
    if (!same) merged.push({ ...q });
    else {
      same.amount += q.amount;
      if (q.followUp) same.followUp = q.followUp;
      if (!same.source.split(', ').includes(q.source)) same.source += `, ${q.source}`;
    }
  }
  allocatePending(ctx, {
    t: 'allocate',
    attacker: queued[0]!.target,
    mode: 'shoot',
    pending: merged,
  });
}
