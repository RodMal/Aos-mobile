/**
 * Allocating damage to a unit and removing casualties. Damage points go into the unit's
 * pool; each time the pool reaches the unit's Health a model is slain and the pool resets.
 * The engine picks the casualties: non-champions first, then the model furthest from the
 * enemy, never breaking coherency when a choice keeps it.
 */
import {
  baseFootprint,
  boundingRadius,
  checkCoherencyFootprints,
  footprintGapAtLeast,
  footprintInsidePolygon,
  footprintsOverlap,
  withinCoherencyRange,
  COHERENCY_RANGE_IN,
  type Footprint,
} from '../geom/index.js';
import { effectiveWard } from './abilities/effects.js';
import { rollWard } from './attack.js';
import type { Ctx } from './ctx.js';
import { boardPolygon } from './movement.js';
import {
  aliveIndices,
  COMBAT_RANGE,
  DIST_EPS,
  modelFootprint,
  opponent,
  profileOf,
  unitFootprints,
  unitsOf,
} from './query.js';
import type { GameState, Scenario, UnitState } from './types.js';
import {
  recordDamageAllocatedForTactics,
  recordUnitDestroyedForTactics,
} from '../rules/core/battleTactics.js';

export type StepCtx = Ctx;

export interface DamageResult {
  taken: number;
  slain: number;
  destroyed: boolean;
}

/**
 * Allocates `amount` damage points (wards already rolled) to `unit`, removes the slain
 * models and emits a `damage` event.
 */
export function allocateDamage(
  ctx: Ctx,
  unit: UnitState,
  amount: number,
  source: string,
): DamageResult {
  if (unit.status !== 'battlefield' || amount <= 0) return { taken: 0, slain: 0, destroyed: false };
  recordDamageAllocatedForTactics(ctx.s, unit.id, ctx.s.phase);
  const health = profileOf(ctx.scenario, unit).health;
  let slain = 0;
  unit.damage += amount;
  const onBattlefield = (): boolean => unit.status === 'battlefield';
  while (unit.damage >= health && onBattlefield()) {
    unit.damage -= health;
    removeModel(ctx.s, unit, pickCasualty(ctx.scenario, ctx.s, unit));
    slain++;
  }
  if (onBattlefield()) slain += restoreCoherency(ctx.scenario, ctx.s, unit);
  const destroyed = !onBattlefield();
  if (destroyed) {
    recordUnitDestroyedForTactics(ctx.scenario, ctx.s, unit);
  }
  ctx.events.push({ t: 'damage', unit: unit.id, amount, slain, destroyed, source });
  if (destroyed) destroySummoned(ctx, unit);
  return { taken: amount, slain, destroyed };
}

/** Mortal damage: wards are rolled, then the damage is allocated. */
export function inflictMortalDamage(
  ctx: Ctx,
  unit: UnitState,
  amount: number,
  source: string,
): DamageResult {
  const wardVal = effectiveWard(ctx.scenario, ctx.s, unit) ?? null;
  const ward = rollWard(ctx.rng, amount, wardVal);
  if (ward.dice.length > 0) {
    ctx.events.push({ t: 'roll', player: unit.owner, label: 'Ward', dice: ward.dice });
  }
  if (ward.taken === 0) {
    ctx.events.push({ t: 'damage', unit: unit.id, amount: 0, slain: 0, destroyed: false, source });
    return { taken: 0, slain: 0, destroyed: false };
  }
  return allocateDamage(ctx, unit, ward.taken, source);
}

export const applyMortalDamage = inflictMortalDamage;

/** Heals up to `amount` damage points allocated to `unit`. */
export function healUnit(ctx: Ctx, unit: UnitState, amount: number, source: string): number {
  if (unit.status !== 'battlefield' || unit.damage <= 0 || amount <= 0) return 0;
  const healed = Math.min(unit.damage, amount);
  unit.damage -= healed;
  ctx.events.push({ t: 'note', text: `${unit.name} heals ${healed} (${source}).` });
  return healed;
}

/** Destroys or banishes a unit/manifestation immediately. */
export function destroyUnit(ctx: Ctx, unit: UnitState, source: string): void {
  if (unit.status !== 'battlefield') return;
  recordUnitDestroyedForTactics(ctx.scenario, ctx.s, unit);
  let slain = 0;
  for (const m of unit.models) {
    if (m.alive) {
      m.alive = false;
      slain++;
    }
  }
  unit.status = 'destroyed';
  unit.damage = 0;
  if (unit.isManifestation) {
    ctx.s.banishedThisTurn = [...(ctx.s.banishedThisTurn ?? []), unit.profileId];
  }
  ctx.events.push({ t: 'damage', unit: unit.id, amount: 0, slain, destroyed: true, source });
  destroySummoned(ctx, unit);
}

/**
 * A manifestation is destroyed when the unit that summoned it is destroyed (owner's ruling,
 * 2026-11-12), by any cause.
 */
function destroySummoned(ctx: Ctx, caster: UnitState): void {
  for (const id of ctx.s.unitOrder) {
    const m = ctx.s.units[id]!;
    if (m.status !== 'battlefield' || !m.isManifestation || m.summonedBy !== caster.id) continue;
    ctx.events.push({ t: 'note', text: `${m.name} is destroyed: ${caster.name} has fallen.` });
    destroyUnit(ctx, m, `${caster.name} has fallen`);
  }
}

function removeModel(state: GameState, unit: UnitState, i: number): void {
  unit.models[i]!.alive = false;
  if (aliveIndices(unit).length === 0) {
    unit.status = 'destroyed';
    unit.damage = 0;
    if (unit.isManifestation) {
      state.banishedThisTurn = [...(state.banishedThisTurn ?? []), unit.profileId];
    }
  }
}

/** Distance from each living model of `unit` to the nearest enemy model (edge to edge). */
function enemyDistances(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): Map<number, number> {
  const enemies = unitsOf(state, opponent(unit.owner)).flatMap((e) => unitFootprints(scenario, e));
  const out = new Map<number, number>();
  for (const i of aliveIndices(unit)) {
    const fp = modelFootprint(scenario, unit, i);
    let best = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(fp.cx - e.cx, fp.cy - e.cy) - boundingRadius(fp) - boundingRadius(e);
      if (d < best) best = d;
    }
    out.set(i, best);
  }
  return out;
}

/** Living model indices in casualty order: non-champions first, then furthest from enemies. */
export function casualtyOrder(scenario: Scenario, state: GameState, unit: UnitState): number[] {
  const profile = profileOf(scenario, unit);
  const dist = enemyDistances(scenario, state, unit);
  return aliveIndices(unit).sort((a, b) => {
    const ca = profile.models[a]!.champion ? 1 : 0;
    const cb = profile.models[b]!.champion ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const d = dist.get(b)! - dist.get(a)!;
    return d !== 0 ? d : b - a;
  });
}

/** The next model to remove: the first in casualty order whose removal keeps coherency. */
export function pickCasualty(scenario: Scenario, state: GameState, unit: UnitState): number {
  const order = casualtyOrder(scenario, state, unit);
  if (order.length <= 2) return order[0]!;
  const fps = new Map(order.map((i) => [i, modelFootprint(scenario, unit, i)]));
  for (const i of order) {
    const rest = order.filter((j) => j !== i).map((j) => fps.get(j)!);
    if (checkCoherencyFootprints(rest).coherent) return i;
  }
  return order[0]!;
}

/** Connected groups of the unit's living models under the coherency range. */
function coherencyGroups(indices: number[], fps: Map<number, Footprint>): number[][] {
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const s of indices) {
    if (seen.has(s)) continue;
    const group = [s];
    seen.add(s);
    for (let k = 0; k < group.length; k++) {
      for (const j of indices) {
        if (seen.has(j)) continue;
        if (withinCoherencyRange(fps.get(group[k]!)!, fps.get(j)!, COHERENCY_RANGE_IN)) {
          seen.add(j);
          group.push(j);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Removes models until the unit is coherent again: models outside the largest group first,
 * then models lacking neighbours. Returns how many were removed.
 */
export function restoreCoherency(scenario: Scenario, state: GameState, unit: UnitState): number {
  let removed = 0;
  for (;;) {
    const alive = aliveIndices(unit);
    if (alive.length <= 1) return removed;
    const fps = new Map(alive.map((i) => [i, modelFootprint(scenario, unit, i)]));
    const result = checkCoherencyFootprints(alive.map((i) => fps.get(i)!));
    if (result.coherent) return removed;
    const order = casualtyOrder(scenario, state, unit);
    let victim: number;
    if (result.groups > 1) {
      const groups = coherencyGroups(alive, fps).sort((a, b) => b.length - a.length);
      const outside = new Set(groups.slice(1).flat());
      victim = order.find((i) => outside.has(i))!;
    } else {
      const lacking = new Set(result.lacking.map((k) => alive[k]!));
      victim = order.find((i) => lacking.has(i)) ?? order[0]!;
    }
    removeModel(state, unit, victim);
    removed++;
  }
}

/**
 * Where slain model `i` can be set up again: touching distance from a living model of its
 * unit, on the battlefield, not on another base, more than 3" from every enemy unit, and
 * with the unit coherent. Null when there is no room.
 */
export function returnPosition(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  i: number,
): { x: number; y: number; rot: number } | null {
  const base = profileOf(scenario, unit).models[i]!.base;
  const board = boardPolygon(scenario);
  const own = aliveIndices(unit).map((j) => modelFootprint(scenario, unit, j));
  const others: Footprint[] = [];
  const enemies: Footprint[] = [];
  for (const id of state.unitOrder) {
    const u = state.units[id]!;
    if (u.status !== 'battlefield' || u.id === unit.id) continue;
    const fps = unitFootprints(scenario, u);
    others.push(...fps);
    if (u.owner !== unit.owner) enemies.push(...fps);
  }
  for (const j of aliveIndices(unit)) {
    const anchor = unit.models[j]!;
    const probe = baseFootprint(base, 0, 0, anchor.rot);
    const dist = boundingRadius(modelFootprint(scenario, unit, j)) + boundingRadius(probe) + 0.1;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      const x = anchor.x + Math.cos(a) * dist;
      const y = anchor.y + Math.sin(a) * dist;
      const fp = baseFootprint(base, x, y, anchor.rot);
      if (!footprintInsidePolygon(fp, board)) continue;
      if (own.some((o) => footprintsOverlap(fp, o))) continue;
      if (others.some((o) => footprintsOverlap(fp, o))) continue;
      if (enemies.some((e) => !footprintGapAtLeast(fp, e, COMBAT_RANGE + DIST_EPS))) continue;
      if (!checkCoherencyFootprints([...own, fp]).coherent) continue;
      return { x, y, rot: anchor.rot };
    }
  }
  return null;
}
