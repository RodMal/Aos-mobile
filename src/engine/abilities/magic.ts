import {
  baseFootprint,
  footprintGap,
  footprintGapAtLeast,
  footprintInsidePolygon,
  footprintOuterRadius,
  footprintOverlapsPolygon,
} from '../../geom/index.js';
import { canStandOn } from '../../data/battlefield.js';
import { reapingBonus } from '../../rules/factions/seasons.js';
import {
  ARCANE_VASSAL_ID,
  arcaneVassalTargets,
  hasSupremeMaster,
  isWizard,
  supremeCastBonus,
  supremeUnbindBonus,
  vassalOf,
} from '../../rules/factions/kroak.js';
import { tepokBonus } from '../../rules/factions/seraphon.js';
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
import {
  CONDUIT_REACTION,
  COATL_REACTION,
  applyConduit,
  castReactionAbilityId,
  castReactionOptions,
  spendCastReaction,
} from '../seraphonActive.js';
import { WYLDWOOD_REVENANTS_ID, chantRerollOptions, spendChantReroll } from '../sylvanethActive.js';
import { addEffect, getAbility, legalTargetsForSpec } from './effects.js';
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

  const radii = [2, 3.5, 5, 6.5, 8, 9.5, 11, 13, 15, 17].filter((r) => r <= range);
  // Only bases near enough to the caster can touch a candidate position; drop the rest once
  // instead of testing them against every candidate.
  const maxRadius = radii[radii.length - 1] ?? 0;
  const candidateReach = maxRadius + footprintOuterRadius(baseFootprint(base, 0, 0, 0)) + 0.05;
  const nearbyFps = otherFps.filter(
    (o) =>
      Math.hypot(o.cx - c.x, o.cy - c.y) - footprintOuterRadius(o) <= candidateReach + DIST_EPS,
  );
  // The answer is the legal position closest to an enemy (the first generated on ties). The
  // score does not depend on legality, so rank every position first (a stable sort keeps the
  // generation order on ties) and return the first legal one instead of testing them all.
  const positions: { x: number; y: number; score: number }[] = [];
  for (const r of radii) {
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const x = c.x + Math.cos(rad) * r;
      const y = c.y + Math.sin(rad) * r;
      let distToEnemy = Infinity;
      for (const ec of enemyCentres) {
        distToEnemy = Math.min(distToEnemy, Math.hypot(x - ec.x, y - ec.y));
      }
      positions.push({ x, y, score: -distToEnemy });
    }
  }
  positions.sort((a, b) => b.score - a.score);
  for (const { x, y } of positions) {
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
      if (!footprintWhollyWithin(fp, casterFps, range)) continue;
      // Never on a feature models cannot stand on (the spires).
      if (
        scenario.battlefield.terrain.some(
          (f) => !canStandOn(scenario.battlefield, f) && footprintOverlapsPolygon(fp, f.polygon),
        )
      )
        continue;
      if (nearbyFps.some((ofp) => !footprintGapAtLeast(fp, ofp, 0.05))) continue;
      return { x, y, rot };
    }
  }
  return null;
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
  // Arcane Vassal: the next Spell is measured from the picked Skink Wizard (I83).
  const origin = vassalOf(state, unit) ?? unit;

  if (canCastSpells(scenario, unit) && !unit.miscast) {
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
          origin,
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
          ? legalTargetsForSpec(scenario, state, origin, def.target).map((u) => u.id)
          : [];
        if (def.target && targets.length === 0) continue;
        out.push({
          t: 'ability',
          abilityId: def.id,
          name: def.name,
          kind: 'spell',
          targetValue: def.castingValue,
          targets,
          ...(def.maxTargets && def.maxTargets > 1 ? { maxTargets: def.maxTargets } : {}),
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

  // Arcane Vassal: once per turn, in your own hero phase (I83).
  if (
    (inHeroMain || inMagicalIntervention) &&
    !usedByUnit.includes(ARCANE_VASSAL_ID) &&
    !vassalOf(state, unit)
  ) {
    const vassals = arcaneVassalTargets(scenario, state, unit);
    if (vassals.length > 0) {
      out.push({
        t: 'ability',
        abilityId: ARCANE_VASSAL_ID,
        name: 'Arcane Vassal',
        kind: 'activated',
        targets: vassals.map((u) => u.id),
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
      (e) =>
        profileOf(scenario, e).isManifestation &&
        (hasSupremeMaster(scenario, unit) || unitsWithin(scenario, unit, e, BANISH_RANGE)),
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

/**
 * Enemy units that may try to unbind `caster`'s spell: Wizards within 30" with power level
 * left this turn (each attempt uses one, shared with casting and banishing, so a Wizard (N)
 * gets N attempts per turn), or a hero with the Dizzying Rage boon.
 */
export function eligibleUnbinders(
  scenario: Scenario,
  state: GameState,
  caster: UnitState,
): UnitState[] {
  return unitsOf(state, opponent(caster.owner)).filter(
    (u) =>
      (canCastSpells(scenario, u) || hasDizzyingRage(state, u)) &&
      // Supreme Master of Order: an enemy Wizard anywhere on the battlefield (I82).
      ((hasSupremeMaster(scenario, u) && isWizard(scenario, caster)) ||
        unitsWithin(scenario, caster, u, UNBIND_RANGE)),
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

type CastReactionsTaken = Extract<Frame, { t: 'castReact' }>['used'];

/** The target or targets an ability action names, checked against the legal ones. */
function pickTargets(
  ctx: StepCtx,
  def: AbilityDefinition,
  legal: UnitId[],
  action: Extract<Action, { t: 'ability' }>,
): { target?: UnitState; targets?: UnitState[] } {
  if (def.target && action.targets) {
    const max = def.maxTargets ?? 1;
    const ids = action.targets;
    if (ids.length < 1 || ids.length > max) {
      throw new IllegalActionError(`${def.name} takes 1 to ${max} targets.`);
    }
    if (new Set(ids).size !== ids.length) {
      throw new IllegalActionError(`${def.name}: each target can be picked only once.`);
    }
    const bad = ids.find((id) => !legal.includes(id));
    if (bad) {
      const name = ctx.s.units[bad]?.name ?? bad;
      throw new IllegalActionError(`${name} is not a legal target for ${def.name}.`);
    }
    const targets = ids.map((id) => unitById(ctx.s, id));
    return { target: targets[0], targets };
  }
  if (def.target) {
    const targetId = action.target ?? legal[0];
    if (!targetId || !legal.includes(targetId)) {
      throw new IllegalActionError(`${def.name} requires a legal target`);
    }
    return { target: unitById(ctx.s, targetId) };
  }
  return {};
}

/**
 * `taken` is set when the spell is declared again after Celestial Conduit and Coatl Familiar were
 * offered (the reactions taken, possibly none); without it they are offered first.
 */
export function declareAbility(
  ctx: StepCtx,
  action: Extract<Action, { t: 'ability' }>,
  taken?: CastReactionsTaken,
): void {
  const unit = unitById(ctx.s, action.unit);
  const options = magicOptionsForUnit(ctx.scenario, ctx.s, unit);
  const opt = options.find((o) => o.t === 'ability' && o.abilityId === action.abilityId);
  if (!opt || opt.t !== 'ability') {
    throw new IllegalActionError(`${unit.name} cannot use ability ${action.abilityId} now`);
  }

  // Celestial Conduit and Coatl Familiar react to the declaration, before the casting roll.
  const declared = getAbility(action.abilityId);
  if (!taken && declared && (declared.kind === 'spell' || declared.kind === 'summon')) {
    pickTargets(ctx, declared, opt.targets, action);
    const offers = castReactionOptions(ctx.scenario, ctx.s, unit);
    if (offers.length > 0) {
      ctx.s.stack.push({ t: 'castReact', action, used: [] });
      ctx.s.stack.push({
        t: 'reaction',
        player: unit.owner,
        options: offers,
        trigger: `declare:${unit.id}:${declared.name}`,
      });
      return;
    }
  }

  if (action.abilityId === ARCANE_VASSAL_ID) {
    const targetId = action.target ?? opt.targets[0];
    if (!targetId || !opt.targets.includes(targetId)) {
      throw new IllegalActionError('Arcane Vassal requires a friendly Skink Wizard within 18"');
    }
    unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), ARCANE_VASSAL_ID];
    addEffect(ctx.s, {
      id: ARCANE_VASSAL_ID,
      name: 'Arcane Vassal',
      sourceUnit: unit.id,
      targetUnit: targetId,
      owner: unit.owner,
      expires: 'phase',
    });
    ctx.events.push({
      t: 'note',
      text: `Arcane Vassal: ${unit.name}'s next Spell is measured from ${unitById(ctx.s, targetId).name}.`,
    });
    return;
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
    const total = dice[0] + dice[1] + supremeUnbindBonus(ctx.scenario, unit);
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

  const { target, targets } = pickTargets(ctx, def, opt.targets, action);

  if (def.kind === 'spell' || def.kind === 'summon') {
    const cv = def.castingValue ?? 6;
    // Arcane Vassal: the picked Skink Wizard counts as the caster (spell or summon) for range,
    // visibility, set-up, Unbind and the effects; the casting roll and a miscast stay with `unit` (I83).
    const vassal = vassalOf(ctx.s, unit);
    const origin = vassal ?? unit;
    if (vassal) {
      ctx.s.effects = (ctx.s.effects ?? []).filter(
        (e) => !(e.id === ARCANE_VASSAL_ID && e.sourceUnit === unit.id),
      );
    }
    markAbilityAttempted(ctx.s, unit, def.id, def.unlimited);
    const dice = roll2D6(ctx);
    const miscast = dice[0] === 1 && dice[1] === 1;
    // Coatl Familiar: add D6 to the casting roll.
    let coatl = 0;
    for (const r of (taken ?? []).filter((x) => x.ability === COATL_REACTION)) {
      const die = rollD6(ctx);
      coatl += die;
      ctx.events.push({ t: 'roll', player: unit.owner, label: 'Coatl Familiar', dice: [die] });
      ctx.events.push({
        t: 'note',
        text: `${unitById(ctx.s, r.unit).name}: Coatl Familiar adds ${die} to the casting roll.`,
      });
    }
    const conduits = (taken ?? []).filter((x) => x.ability === CONDUIT_REACTION).map((x) => x.unit);
    const total = Math.max(
      2,
      dice[0] +
        dice[1] +
        coatl +
        penalty +
        channelledWrathBonus(ctx.s, unit) +
        reapingBonus(ctx.scenario, ctx.s, unit) +
        tepokBonus(ctx.scenario, ctx.s, unit) +
        supremeCastBonus(ctx.scenario, unit),
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
      // Miscast: the spell fails, D3 mortal damage to the caster, and it cannot use more
      // spells this phase. Its power level is not used up: it may still unbind and banish.
      unit.miscast = true;
      const dmg = rollD3(ctx, unit.owner, 'Miscast damage');
      applyMortalDamage(ctx, unit, dmg, 'Miscast');
      return;
    }
    if (!success) return;

    const unbinders = eligibleUnbinders(ctx.scenario, ctx.s, origin);
    if (unbinders.length > 0) {
      ctx.s.stack.push({
        t: 'spell',
        unit: origin.id,
        abilityId: def.id,
        target: target?.id,
        ...(targets ? { targets: targets.map((u) => u.id) } : {}),
        roll: total,
        ...(conduits.length > 0 ? { conduits } : {}),
      });
      ctx.s.stack.push({
        t: 'reaction',
        player: opponent(unit.owner),
        options: unbinders.map((u) => ({ ability: 'unbind', unit: u.id, cost: 0 })),
        trigger: `spell:${origin.id}:${def.name}`,
      });
      return;
    }

    for (const bearer of conduits) applyConduit(ctx, bearer);
    resolveSpellOrSummon(ctx, origin, def, target, total, targets);
    return;
  }

  if (def.kind === 'prayer') {
    markAbilityAttempted(ctx.s, unit, def.id, def.unlimited);
    const die = rollD6(ctx);
    // Wyldwood Revenants: an unmodified roll of 1 may be re-rolled, before it costs points.
    if (die === 1) {
      const offers = chantRerollOptions(ctx.scenario, ctx.s, unit);
      if (offers.length > 0) {
        ctx.s.stack.push({
          t: 'chantReact',
          unit: unit.id,
          abilityId: def.id,
          ...(target ? { target: target.id } : {}),
          legal: opt.targets,
          action,
          penalty,
        });
        ctx.s.stack.push({
          t: 'reaction',
          player: unit.owner,
          options: offers,
          trigger: `chant:${unit.id}:${def.name}`,
        });
        return;
      }
    }
    resolveChant(ctx, unit, def, opt.targets, target, action, penalty, die);
    return;
  }

  def.resolve?.({ ctx, unit, target, choice: action.choice });
}

/** The answer to the Wyldwood Revenants reaction: re-roll the chanting roll of 1, or keep it. */
export function answerChantReroll(ctx: StepCtx, action: Action): void {
  const { s } = ctx;
  const reaction = s.stack[s.stack.length - 1];
  const frame = s.stack[s.stack.length - 2];
  if (reaction?.t !== 'reaction' || frame?.t !== 'chantReact') {
    throw new IllegalActionError('There is no chanting roll to re-roll.');
  }
  let die = 1;
  if (action.t === 'ability') {
    const offer = reaction.options.find(
      (o) => o.ability === 'wyldwoodRevenants' && o.unit === action.unit,
    );
    if (!offer || action.abilityId !== WYLDWOOD_REVENANTS_ID) {
      throw new IllegalActionError('That reaction is not available.');
    }
    spendChantReroll(ctx, unitById(s, offer.unit));
    die = rollD6(ctx);
    ctx.events.push({
      t: 'roll',
      player: reaction.player,
      label: 'Wyldwood Revenants (re-roll)',
      dice: [die],
    });
  } else if (action.t !== 'pass') {
    throw new IllegalActionError('Re-roll the chanting roll or keep it.');
  }
  s.stack.pop(); // reaction
  s.stack.pop(); // chantReact
  const def = getAbility(frame.abilityId);
  if (!def) return;
  resolveChant(
    ctx,
    unitById(s, frame.unit),
    def,
    frame.legal,
    frame.target ? unitById(s, frame.target) : undefined,
    frame.action,
    frame.penalty,
    die,
  );
}

/** What a chanting roll does once it is final: lose points on a 1, else bank or answer. */
function resolveChant(
  ctx: StepCtx,
  unit: UnitState,
  def: AbilityDefinition,
  legalTargets: UnitId[],
  target: UnitState | undefined,
  action: Extract<Action, { t: 'ability' }>,
  penalty: number,
  die: number,
): void {
  const cv = def.chantingValue ?? 4;
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

  // The roll answers the prayer: the player chooses to use it now or to bank the points.
  let secondTarget: UnitState | undefined;
  if (action.secondTarget && legalTargets.includes(action.secondTarget)) {
    secondTarget = unitById(ctx.s, action.secondTarget);
  } else if (
    def.highChantThreshold &&
    currentPoints >= def.highChantThreshold &&
    legalTargets.length > 1
  ) {
    const otherId = legalTargets.find((id) => id !== target?.id);
    if (otherId) secondTarget = unitById(ctx.s, otherId);
  }
  ctx.s.stack.push({
    t: 'prayer',
    unit: unit.id,
    abilityId: def.id,
    ...(target ? { target: target.id } : {}),
    ...(secondTarget ? { secondTarget: secondTarget.id } : {}),
    ...(action.choice ? { choice: action.choice } : {}),
    die,
    points: currentPoints,
  });
  return;
}

/** The answer to a `prayer` decision: `use` answers the prayer now, `bank` keeps the points. */
export function choosePrayer(ctx: StepCtx, action: Action): void {
  const frame = ctx.s.stack[ctx.s.stack.length - 1];
  if (frame?.t !== 'prayer') throw new IllegalActionError('There is no prayer to answer.');
  if (action.t !== 'choose' || (action.value !== 'use' && action.value !== 'bank')) {
    throw new IllegalActionError('Use the prayer now, or bank the ritual points.');
  }
  ctx.s.stack.pop();
  const unit = unitById(ctx.s, frame.unit);
  const def = getAbility(frame.abilityId);
  if (!def) return;
  const cv = def.chantingValue ?? 4;
  if (action.value === 'bank') {
    unit.ritualPoints = frame.points;
    ctx.events.push({
      t: 'chant',
      unit: unit.id,
      ability: def.name,
      die: frame.die,
      total: frame.points,
      targetValue: cv,
      answered: false,
      ritualPoints: unit.ritualPoints,
    });
    return;
  }
  unit.ritualPoints = 0;
  ctx.events.push({
    t: 'chant',
    unit: unit.id,
    ability: def.name,
    die: frame.die,
    total: frame.points,
    targetValue: cv,
    answered: true,
    ritualPoints: 0,
  });
  def.resolve?.({
    ctx,
    unit,
    target: frame.target ? unitById(ctx.s, frame.target) : undefined,
    secondTarget: frame.secondTarget ? unitById(ctx.s, frame.secondTarget) : undefined,
    roll: frame.points,
    choice: frame.choice,
  });
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
    const total = dice[0] + dice[1] + supremeUnbindBonus(ctx.scenario, unbinder);
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
  for (const bearer of frame.conduits ?? []) applyConduit(ctx, bearer);

  const target = frame.target ? ctx.s.units[frame.target] : undefined;
  const targets = frame.targets?.map((id) => unitById(ctx.s, id));
  resolveSpellOrSummon(ctx, caster, def, target, frame.roll, targets);
}

export function resolveSpellOrSummon(
  ctx: StepCtx,
  caster: UnitState,
  def: AbilityDefinition,
  target: UnitState | undefined,
  roll: number,
  targets?: UnitState[],
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
      summonedBy: caster.id,
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

  if (targets) {
    // Several targets: those still on the battlefield are affected.
    const left = targets.filter((u) => u.status === 'battlefield');
    if (left.length === 0) return;
    def.resolve?.({ ctx, unit: caster, target: left[0], targets: left, roll });
    return;
  }
  if (target && target.status !== 'battlefield') return;
  def.resolve?.({ ctx, unit: caster, target, roll });
}

export type { AbilityOptionKind };

/**
 * An answer to the reactions offered for a declared spell: use Celestial Conduit or Coatl
 * Familiar (`ability` action by the unit), or pass. Once nothing more is offered, or on a pass,
 * the spell is declared again with the reactions taken.
 */
export function answerCastReaction(ctx: StepCtx, action: Action): void {
  const { s } = ctx;
  const reaction = s.stack[s.stack.length - 1];
  const frame = s.stack[s.stack.length - 2];
  if (reaction?.t !== 'reaction' || frame?.t !== 'castReact') {
    throw new IllegalActionError('There is no spell reaction to answer.');
  }
  const caster = unitById(s, frame.action.unit);
  let used = frame.used;
  if (action.t === 'ability') {
    const offer = reaction.options.find(
      (o) =>
        o.unit === action.unit &&
        (o.ability === CONDUIT_REACTION || o.ability === COATL_REACTION) &&
        castReactionAbilityId(o.ability) === action.abilityId,
    );
    if (!offer || (offer.ability !== CONDUIT_REACTION && offer.ability !== COATL_REACTION)) {
      throw new IllegalActionError('That reaction is not available.');
    }
    spendCastReaction(ctx, offer.ability, unitById(s, offer.unit));
    used = [...used, { ability: offer.ability, unit: offer.unit }];
    const more = castReactionOptions(ctx.scenario, s, caster, used);
    if (more.length > 0) {
      s.stack.pop();
      s.stack[s.stack.length - 1] = { ...frame, used };
      s.stack.push({ ...reaction, options: more });
      return;
    }
  } else if (action.t !== 'pass') {
    throw new IllegalActionError('Use a reaction or pass.');
  }
  s.stack.pop(); // reaction
  s.stack.pop(); // castReact
  declareAbility(ctx, frame.action, used);
}
