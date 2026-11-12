import {
  baseFootprint,
  footprintGap,
  footprintGapAtLeast,
  footprintInsidePolygon,
  footprintOuterRadius,
} from '../../geom/index.js';
import { reapingBonus } from '../../rules/factions/seasons.js';
import { applyMortalDamage, destroyUnit, type StepCtx } from '../damage.js';
import { roll2D6, rollD3, rollD6 } from '../ctx.js';
import { boardPolygon } from '../movement.js';
import {
  DIST_EPS,
  footprintWhollyWithin,
  opponent,
  profileOf,
  unitById,
  unitCentre,
  unitFootprints,
  unitsOf,
  unitsWithin,
} from '../query.js';
import {
  IllegalActionError,
  type AbilityOptionKind,
  type Action,
  type Frame,
  type GameState,
  type PlayerId,
  type Scenario,
  type UnitId,
  type UnitOption,
  type UnitState,
} from '../types.js';
import { getAbility, legalTargetsForSpec } from './effects.js';
import type { AbilityDefinition } from './types.js';

export const UNBIND_RANGE = 30;
export const BANISH_RANGE = 30;

export function remainingPowerLevel(scenario: Scenario, unit: UnitState): number {
  const p = profileOf(scenario, unit);
  const power = Math.max(p.wizard ?? 0, p.priest ?? 0);
  return Math.max(0, power - (unit.castsUsed ?? 0));
}

/** Place of Power boons that change magic (Core Rules / GHB 2026-27, docs I36). */
function placeOfPowerBoon(state: GameState, unit: UnitState): string | null {
  const eff = (state.effects ?? []).find(
    (e) => e.id === 'place-of-power' && e.targetUnit === unit.id,
  );
  const boon = eff?.data?.['boon'];
  return typeof boon === 'string' ? boon : null;
}

/** Channelled Wrath: +1 to casting and chanting rolls for the hero this turn. */
function channelledWrathBonus(state: GameState, unit: UnitState): number {
  return placeOfPowerBoon(state, unit) === 'channelled_wrath' ? 1 : 0;
}

/** Dizzying Rage: the hero can unbind or banish once this turn, even if it is no wizard. */
function hasDizzyingRage(state: GameState, unit: UnitState): boolean {
  return unit.status === 'battlefield' && placeOfPowerBoon(state, unit) === 'dizzying_rage';
}

/** Uses up the Dizzying Rage boon. Mutates `state`. */
function spendDizzyingRage(state: GameState, unit: UnitState): void {
  state.effects = (state.effects ?? []).filter(
    (e) => !(e.id === 'place-of-power' && e.targetUnit === unit.id),
  );
}

export function canCastSpells(scenario: Scenario, unit: UnitState): boolean {
  if (unit.status !== 'battlefield') return false;
  const p = profileOf(scenario, unit);
  return (p.wizard ?? 0) > 0 && remainingPowerLevel(scenario, unit) > 0;
}

export function canChantPrayers(scenario: Scenario, unit: UnitState): boolean {
  if (unit.status !== 'battlefield') return false;
  const p = profileOf(scenario, unit);
  return (p.priest ?? 0) > 0 && remainingPowerLevel(scenario, unit) > 0;
}

export function canUsePowerLevelAbility(scenario: Scenario, unit: UnitState): boolean {
  if (unit.status !== 'battlefield') return false;
  const p = profileOf(scenario, unit);
  return ((p.wizard ?? 0) > 0 || (p.priest ?? 0) > 0) && remainingPowerLevel(scenario, unit) > 0;
}

export function knownSpellAndSummonIds(scenario: Scenario, unit: UnitState): string[] {
  const army = scenario.armies[unit.owner];
  const ids: string[] = [];
  for (const a of army.spellLore?.abilities ?? []) ids.push(a.id);
  for (const s of army.manifestationLore?.summons ?? []) ids.push(s.abilityId);
  for (const a of profileOf(scenario, unit).abilities) {
    if (a.kind === 'spell' && !ids.includes(a.id)) ids.push(a.id);
  }
  return ids;
}

export function knownPrayerIds(scenario: Scenario, unit: UnitState): string[] {
  const army = scenario.armies[unit.owner];
  const ids: string[] = [];
  for (const a of army.prayerLore?.abilities ?? []) ids.push(a.id);
  for (const a of profileOf(scenario, unit).abilities) {
    if (a.kind === 'prayer' && !ids.includes(a.id)) ids.push(a.id);
  }
  return ids;
}

export function manifestationUnitId(owner: PlayerId, warscrollId: string): UnitId {
  return `m:${owner}:${warscrollId}`;
}

export function isManifestationInPlayOrBanished(
  state: GameState,
  owner: PlayerId,
  warscrollId: string,
): boolean {
  if ((state.banishedThisTurn ?? []).includes(warscrollId)) return true;
  const id = manifestationUnitId(owner, warscrollId);
  const existing = state.units[id];
  return Boolean(existing && existing.status === 'battlefield');
}

/**
 * Memo for `findSummonPlacement`, keyed by everything the search reads: the arguments and the
 * position and status of every model on the battlefield. The search is pure, so a hit returns
 * exactly what a fresh search would; it only saves time (unit options are asked for the same
 * position many times). Bounded, and per scenario.
 */
const summonMemo = new WeakMap<
  Scenario,
  Map<string, { x: number; y: number; rot: number } | null>
>();

function summonKey(
  state: GameState,
  caster: UnitState,
  warscrollId: string,
  range: number,
  minEnemyGap: number,
): string {
  const parts = [caster.id, caster.owner, warscrollId, range, minEnemyGap].join('|');
  let units = '';
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    if (u.status !== 'battlefield') continue;
    units += `${id}:${u.owner}`;
    for (const m of u.models) units += m.alive ? `,${m.x},${m.y},${m.rot}` : ',-';
    units += ';';
  }
  return `${parts}#${units}`;
}

export function findSummonPlacement(
  scenario: Scenario,
  state: GameState,
  caster: UnitState,
  warscrollId: string,
  range: number,
  minEnemyGap: number,
): { x: number; y: number; rot: number } | null {
  let memo = summonMemo.get(scenario);
  if (!memo) {
    memo = new Map();
    summonMemo.set(scenario, memo);
  }
  const key = summonKey(state, caster, warscrollId, range, minEnemyGap);
  const hit = memo.get(key);
  if (hit !== undefined) return hit ? { ...hit } : null;
  const found = searchSummonPlacement(scenario, state, caster, warscrollId, range, minEnemyGap);
  if (memo.size >= 256) memo.clear();
  memo.set(key, found);
  return found ? { ...found } : null;
}

function searchSummonPlacement(
  scenario: Scenario,
  state: GameState,
  caster: UnitState,
  warscrollId: string,
  range: number,
  minEnemyGap: number,
): { x: number; y: number; rot: number } | null {
  const profile = scenario.profiles[warscrollId];
  if (!profile || profile.models.length === 0) return null;
  const base = profile.models[0]!.base;
  const casterFps = unitFootprints(scenario, caster);
  if (casterFps.length === 0) return null;
  const c = unitCentre(caster);
  const board = boardPolygon(scenario);

  const otherFps = state.unitOrder
    .map((id) => state.units[id]!)
    .filter(
      (u) => u.status === 'battlefield' && u.id !== manifestationUnitId(caster.owner, warscrollId),
    )
    .flatMap((u) => unitFootprints(scenario, u));

  const enemies = unitsOf(state, opponent(caster.owner));
  const enemyCentres = enemies.map((e) => unitCentre(e));
  const enemyFps = minEnemyGap > 0 ? enemies.flatMap((e) => unitFootprints(scenario, e)) : [];
  const boardW = scenario.battlefield.width;
  const boardH = scenario.battlefield.height;

  const candidates: { x: number; y: number; rot: number; score: number }[] = [];
  const radii = [2, 3.5, 5, 6.5, 8, 9.5, 11, 13, 15, 17].filter((r) => r <= range);
  // Only bases near enough to the caster can touch a candidate position; drop the rest once
  // instead of testing them against every candidate.
  const maxRadius = radii[radii.length - 1] ?? 0;
  const candidateReach = maxRadius + footprintOuterRadius(baseFootprint(base, 0, 0, 0)) + 0.05;
  const nearbyFps = otherFps.filter(
    (o) =>
      Math.hypot(o.cx - c.x, o.cy - c.y) - footprintOuterRadius(o) <= candidateReach + DIST_EPS,
  );
  for (const r of radii) {
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const x = c.x + Math.cos(rad) * r;
      const y = c.y + Math.sin(rad) * r;
      for (const rot of [0, 90]) {
        const fp = baseFootprint(base, x, y, rot);
        // The board is a rectangle: a base whose outer circle (the one the exact tests use)
        // is inside it needs no polygon test, and one whose centre is off it is never inside.
        const br = footprintOuterRadius(fp);
        const clearOfEdges = x - br >= 0 && y - br >= 0 && x + br <= boardW && y + br <= boardH;
        if (!clearOfEdges) {
          if (x < 0 || y < 0 || x > boardW || y > boardH) continue;
          if (!footprintInsidePolygon(fp, board)) continue;
        }
        if (!footprintWhollyWithin(fp, casterFps, range)) continue;
        if (nearbyFps.some((ofp) => !footprintGapAtLeast(fp, ofp, 0.05))) continue;
        if (minEnemyGap > 0) {
          // Circles first; the exact gap only for enemy bases that could be close enough.
          const limit = minEnemyGap + DIST_EPS;
          let tooClose = false;
          for (const efp of enemyFps) {
            const d = Math.hypot(fp.cx - efp.cx, fp.cy - efp.cy);
            if (d - br - footprintOuterRadius(efp) > limit) continue;
            if (footprintGap(fp, efp) <= limit) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;
        }
        let distToEnemy = Infinity;
        for (const ec of enemyCentres) {
          distToEnemy = Math.min(distToEnemy, Math.hypot(x - ec.x, y - ec.y));
        }
        candidates.push({ x, y, rot, score: -distToEnemy });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  return { x: best.x, y: best.y, rot: best.rot };
}

export function magicOptionsForUnit(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  /** Leave out summons (their placement search is the slow part), for a quick "any option?". */
  skipSummons = false,
): UnitOption[] {
  const top = state.stack[state.stack.length - 1];
  const inMagicalIntervention = top?.t === 'magicalIntervention' && top.unit === unit.id;
  const inHeroMain =
    state.stack.length === 0 && state.phase === 'hero' && state.active === unit.owner;
  if (!inHeroMain && !inMagicalIntervention) return [];

  const out: UnitOption[] = [];
  const usedByUnit = unit.abilitiesUsed ?? [];
  const usedByArmy = state.players[unit.owner].spellsAttempted ?? [];

  if (canCastSpells(scenario, unit)) {
    for (const id of knownSpellAndSummonIds(scenario, unit)) {
      const def = getAbility(id);
      if (!def) continue;
      if (!def.repeatSameUnit && usedByUnit.includes(def.id)) continue;
      if (!def.unlimited && !def.repeatSameUnit && usedByArmy.includes(def.id)) continue;
      if (def.canUse && !def.canUse(scenario, state, unit)) continue;

      if (def.kind === 'summon' && def.summonWarscrollId) {
        if (skipSummons) continue;
        if (isManifestationInPlayOrBanished(state, unit.owner, def.summonWarscrollId)) continue;
        const pos = findSummonPlacement(
          scenario,
          state,
          unit,
          def.summonWarscrollId,
          def.summonRange ?? 12,
          def.summonMinEnemyGap ?? 9,
        );
        if (!pos) continue;
        out.push({
          t: 'ability',
          abilityId: def.id,
          name: def.name,
          kind: 'summon',
          targetValue: def.castingValue,
          targets: [],
        });
      } else if (def.kind === 'spell') {
        const targets = def.target
          ? legalTargetsForSpec(scenario, state, unit, def.target).map((u) => u.id)
          : [];
        if (def.target && targets.length === 0) continue;
        out.push({
          t: 'ability',
          abilityId: def.id,
          name: def.name,
          kind: 'spell',
          targetValue: def.castingValue,
          targets,
        });
      }
    }
  }

  if (canChantPrayers(scenario, unit)) {
    for (const id of knownPrayerIds(scenario, unit)) {
      const def = getAbility(id);
      if (!def || def.kind !== 'prayer') continue;
      if (usedByUnit.includes(def.id)) continue;
      if (!def.unlimited && usedByArmy.includes(def.id)) continue;
      if (def.canUse && !def.canUse(scenario, state, unit)) continue;

      const targets = def.target
        ? legalTargetsForSpec(scenario, state, unit, def.target).map((u) => u.id)
        : [];
      if (def.target && targets.length === 0) continue;
      out.push({
        t: 'ability',
        abilityId: def.id,
        name: def.name,
        kind: 'prayer',
        targetValue: def.chantingValue,
        targets,
      });
    }
  }

  // Banish Manifestation: your hero phase, or the enemy hero phase through Magical
  // Intervention ("a Spell, Prayer or Banish ability"; owner's ruling, 2026-11-11).
  if (
    (inHeroMain || inMagicalIntervention) &&
    (canUsePowerLevelAbility(scenario, unit) || hasDizzyingRage(state, unit)) &&
    !usedByUnit.includes('banish')
  ) {
    const enemyManifestations = unitsOf(state, opponent(unit.owner)).filter(
      (e) => profileOf(scenario, e).isManifestation && unitsWithin(scenario, unit, e, BANISH_RANGE),
    );
    if (enemyManifestations.length > 0) {
      out.push({
        t: 'ability',
        abilityId: 'banish',
        name: 'Banish Manifestation',
        kind: 'banish',
        targets: enemyManifestations.map((e) => e.id),
      });
    }
  }

  return out;
}

/** True when the unit has any magic option now (summons searched only when nothing else is). */
export function hasMagicOption(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return (
    magicOptionsForUnit(scenario, state, unit, true).length > 0 ||
    magicOptionsForUnit(scenario, state, unit).length > 0
  );
}

export function eligibleUnbinders(
  scenario: Scenario,
  state: GameState,
  caster: UnitState,
): UnitState[] {
  return unitsOf(state, opponent(caster.owner)).filter(
    (u) =>
      (canCastSpells(scenario, u) || hasDizzyingRage(state, u)) &&
      !(u.abilitiesUsed ?? []).includes('unbind') &&
      unitsWithin(scenario, caster, u, UNBIND_RANGE),
  );
}

function markAbilityAttempted(
  state: GameState,
  unit: UnitState,
  abilityId: string,
  unlimited?: boolean,
): void {
  unit.castsUsed = (unit.castsUsed ?? 0) + 1;
  unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), abilityId];
  if (!unlimited && abilityId !== 'banish' && abilityId !== 'unbind') {
    const p = state.players[unit.owner];
    p.spellsAttempted = [...(p.spellsAttempted ?? []), abilityId];
  }
}

export function declareAbility(ctx: StepCtx, action: Extract<Action, { t: 'ability' }>): void {
  const unit = unitById(ctx.s, action.unit);
  const options = magicOptionsForUnit(ctx.scenario, ctx.s, unit);
  const opt = options.find((o) => o.t === 'ability' && o.abilityId === action.abilityId);
  if (!opt || opt.t !== 'ability') {
    throw new IllegalActionError(`${unit.name} cannot use ability ${action.abilityId} now`);
  }

  // Pop magicalIntervention frame if we were inside one
  const top = ctx.s.stack[ctx.s.stack.length - 1];
  const wasMagicalIntervention = top?.t === 'magicalIntervention' && top.unit === unit.id;
  if (wasMagicalIntervention) {
    ctx.s.stack.pop();
  }
  const penalty = wasMagicalIntervention || unit.magicalIntervention ? -1 : 0;
  unit.magicalIntervention = false;

  if (action.abilityId === 'banish') {
    const targetId = action.target ?? opt.targets[0];
    if (!targetId || !opt.targets.includes(targetId)) {
      throw new IllegalActionError(
        'Banish Manifestation requires a legal enemy manifestation within 30"',
      );
    }
    const target = unitById(ctx.s, targetId);
    const tp = profileOf(ctx.scenario, target);
    const targetValue = tp.banishment ?? 7;
    if (hasDizzyingRage(ctx.s, unit)) {
      spendDizzyingRage(ctx.s, unit);
      unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), 'banish'];
    } else {
      markAbilityAttempted(ctx.s, unit, 'banish', true);
    }
    const dice = roll2D6(ctx);
    const total = dice[0] + dice[1];
    const banished = total >= targetValue;
    ctx.events.push({
      t: 'banish',
      unit: unit.id,
      target: target.id,
      dice,
      total,
      targetValue,
      banished,
    });
    if (banished) {
      destroyUnit(ctx, target, 'Banish Manifestation');
    }
    return;
  }

  const def = getAbility(action.abilityId);
  if (!def) throw new IllegalActionError(`unknown ability ${action.abilityId}`);

  let target: UnitState | undefined;
  if (def.target) {
    const targetId = action.target ?? opt.targets[0];
    if (!targetId || !opt.targets.includes(targetId)) {
      throw new IllegalActionError(`${def.name} requires a legal target`);
    }
    target = unitById(ctx.s, targetId);
  }

  if (def.kind === 'spell' || def.kind === 'summon') {
    const cv = def.castingValue ?? 6;
    markAbilityAttempted(ctx.s, unit, def.id, def.unlimited);
    const dice = roll2D6(ctx);
    const miscast = dice[0] === 1 && dice[1] === 1;
    const total = Math.max(
      2,
      dice[0] +
        dice[1] +
        penalty +
        channelledWrathBonus(ctx.s, unit) +
        reapingBonus(ctx.scenario, ctx.s, unit),
    );
    const success = !miscast && total >= cv;
    ctx.events.push({
      t: 'cast',
      unit: unit.id,
      ability: def.name,
      dice,
      total,
      targetValue: cv,
      success,
      miscast,
    });
    if (miscast) {
      // Miscast: spell fails, D3 mortal damage to caster, cannot cast more spells this phase
      const p = profileOf(ctx.scenario, unit);
      unit.castsUsed = Math.max(p.wizard ?? 0, p.priest ?? 0);
      const dmg = rollD3(ctx, unit.owner, 'Miscast damage');
      applyMortalDamage(ctx, unit, dmg, 'Miscast');
      return;
    }
    if (!success) return;

    const unbinders = eligibleUnbinders(ctx.scenario, ctx.s, unit);
    if (unbinders.length > 0) {
      ctx.s.stack.push({
        t: 'spell',
        unit: unit.id,
        abilityId: def.id,
        target: target?.id,
        roll: total,
      });
      ctx.s.stack.push({
        t: 'reaction',
        player: opponent(unit.owner),
        options: unbinders.map((u) => ({ ability: 'unbind', unit: u.id, cost: 0 })),
        trigger: `spell:${unit.id}:${def.name}`,
      });
      return;
    }

    resolveSpellOrSummon(ctx, unit, def, target, total);
    return;
  }

  if (def.kind === 'prayer') {
    const cv = def.chantingValue ?? 4;
    markAbilityAttempted(ctx.s, unit, def.id, def.unlimited);
    const die = rollD6(ctx);
    if (die === 1) {
      const lost = rollD3(ctx, unit.owner, 'Chanting roll of 1');
      unit.ritualPoints = Math.max(0, (unit.ritualPoints ?? 0) - lost);
      ctx.events.push({
        t: 'chant',
        unit: unit.id,
        ability: def.name,
        die,
        total: 1,
        targetValue: cv,
        answered: false,
        ritualPoints: unit.ritualPoints,
      });
      return;
    }

    const modifiedDie = Math.max(
      1,
      die + penalty + channelledWrathBonus(ctx.s, unit) + reapingBonus(ctx.scenario, ctx.s, unit),
    );
    const currentPoints = (unit.ritualPoints ?? 0) + modifiedDie;
    const bankOnly = action.choice === 'bank' || currentPoints < cv;
    if (bankOnly) {
      unit.ritualPoints = currentPoints;
      ctx.events.push({
        t: 'chant',
        unit: unit.id,
        ability: def.name,
        die,
        total: currentPoints,
        targetValue: cv,
        answered: false,
        ritualPoints: unit.ritualPoints,
      });
      return;
    }

    // Prayer is answered!
    unit.ritualPoints = 0;
    ctx.events.push({
      t: 'chant',
      unit: unit.id,
      ability: def.name,
      die,
      total: currentPoints,
      targetValue: cv,
      answered: true,
      ritualPoints: 0,
    });
    let secondTarget: UnitState | undefined;
    if (action.secondTarget && opt.targets.includes(action.secondTarget)) {
      secondTarget = unitById(ctx.s, action.secondTarget);
    } else if (
      def.highChantThreshold &&
      currentPoints >= def.highChantThreshold &&
      opt.targets.length > 1
    ) {
      const otherId = opt.targets.find((id) => id !== target?.id);
      if (otherId) secondTarget = unitById(ctx.s, otherId);
    }
    def.resolve?.({
      ctx,
      unit,
      target,
      secondTarget,
      roll: currentPoints,
      choice: action.choice,
    });
    return;
  }

  def.resolve?.({ ctx, unit, target, choice: action.choice });
}

export function resolvePendingSpell(
  ctx: StepCtx,
  frame: Extract<Frame, { t: 'spell' }>,
  unbinderId?: UnitId,
): void {
  const caster = unitById(ctx.s, frame.unit);
  const def = getAbility(frame.abilityId);
  if (!def) return;

  if (unbinderId) {
    const unbinder = unitById(ctx.s, unbinderId);
    if (hasDizzyingRage(ctx.s, unbinder)) spendDizzyingRage(ctx.s, unbinder);
    else unbinder.castsUsed = (unbinder.castsUsed ?? 0) + 1;
    unbinder.abilitiesUsed = [...(unbinder.abilitiesUsed ?? []), 'unbind'];
    const dice = roll2D6(ctx);
    const total = dice[0] + dice[1];
    const unbound = total > frame.roll;
    ctx.events.push({
      t: 'unbind',
      unit: unbinder.id,
      caster: caster.id,
      ability: def.name,
      dice,
      total,
      castTotal: frame.roll,
      unbound,
    });
    if (unbound) return;
  }

  const target = frame.target ? ctx.s.units[frame.target] : undefined;
  resolveSpellOrSummon(ctx, caster, def, target, frame.roll);
}

export function resolveSpellOrSummon(
  ctx: StepCtx,
  caster: UnitState,
  def: AbilityDefinition,
  target: UnitState | undefined,
  roll: number,
): void {
  if (def.kind === 'summon' && def.summonWarscrollId) {
    const warscrollId = def.summonWarscrollId;
    const range = def.summonRange ?? 12;
    const minEnemyGap = def.summonMinEnemyGap ?? 9;
    const pos = findSummonPlacement(ctx.scenario, ctx.s, caster, warscrollId, range, minEnemyGap);
    if (!pos) return;
    const profile = ctx.scenario.profiles[warscrollId]!;
    const unitId = manifestationUnitId(caster.owner, warscrollId);
    const unitState: UnitState = {
      id: unitId,
      owner: caster.owner,
      profileId: warscrollId,
      name: profile.name,
      armyIndex: 99,
      models: [{ x: pos.x, y: pos.y, rot: pos.rot, alive: true }],
      damage: 0,
      status: 'battlefield',
      moved: null,
      charged: false,
      shot: false,
      fought: false,
      setUpThisTurn: true,
      isManifestation: true,
    };
    ctx.s.units[unitId] = unitState;
    if (!ctx.s.unitOrder.includes(unitId)) {
      ctx.s.unitOrder.push(unitId);
    }
    ctx.s.stack.push({
      t: 'place',
      unit: unitId,
      reason: 'summon',
      allowance: range,
      dice: [],
      caster: caster.id,
      minEnemyGap,
    });
    return;
  }

  if (target && target.status !== 'battlefield') return;
  def.resolve?.({ ctx, unit: caster, target, roll });
}

export type { AbilityOptionKind };
