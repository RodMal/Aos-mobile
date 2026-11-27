import type { Weapon } from '../../data/profile.js';
import type { AttackSituation, Modifier } from '../../rules/core/modifiers.js';
import type { StepCtx } from '../damage.js';
import { inCreepingOvergrowth } from '../overgrowth.js';
import { isUnitVisible } from '../terrain.js';
import {
  enemiesWithin,
  hasKeyword,
  opponent,
  profileOf,
  unitWhollyWithin,
  unitsOf,
  unitsWithin,
} from '../query.js';
import type {
  ActiveEffect,
  EffectExpiry,
  FightTier,
  GameState,
  PlayerId,
  Scenario,
  UnitId,
  UnitState,
} from '../types.js';
import type {
  AbilityDefinition,
  AbilityTargetSpec,
  TriggerPayload,
  TriggerWindow,
  UnitGrants,
} from './types.js';

const REGISTRY = new Map<string, AbilityDefinition>();

let auraCache: AbilityDefinition[] | null = null;
let lateAuraCache: AbilityDefinition[] | null = null;
let areaCache: AbilityDefinition[] | null = null;

export function registerAbility(def: AbilityDefinition): void {
  REGISTRY.set(def.id, def);
  auraCache = null;
  lateAuraCache = null;
  areaCache = null;
}

function areaDefinitions(): AbilityDefinition[] {
  areaCache ??= [...REGISTRY.values()].filter((d) => d.areaModifiers);
  return areaCache;
}

function auraDefinitions(): AbilityDefinition[] {
  auraCache ??= [...REGISTRY.values()].filter((d) => d.auraGrants);
  return auraCache;
}

function lateAuraDefinitions(): AbilityDefinition[] {
  lateAuraCache ??= [...REGISTRY.values()].filter((d) => d.lateAuraGrants);
  return lateAuraCache;
}

export function getAbility(id: string): AbilityDefinition | undefined {
  return REGISTRY.get(id);
}

export function allRegisteredAbilities(): AbilityDefinition[] {
  return [...REGISTRY.values()];
}

export function addEffect(state: GameState, effect: ActiveEffect): void {
  state.effects = [...(state.effects ?? []), effect];
}

export function clearExpiredEffects(
  state: GameState,
  window: EffectExpiry,
  activePlayer?: PlayerId,
): void {
  if (!state.effects || state.effects.length === 0) return;
  state.effects = state.effects.filter((e) => {
    if (e.expires !== window) return true;
    if (window === 'startOfNextTurn') {
      return e.owner !== activePlayer;
    }
    return false;
  });
}

export function effectsOnUnit(state: GameState, unitId: UnitId): ActiveEffect[] {
  return (state.effects ?? []).filter((e) => e.targetUnit === unitId);
}

export function legalTargetsForSpec(
  scenario: Scenario,
  state: GameState,
  source: UnitState,
  spec: AbilityTargetSpec,
): UnitState[] {
  const candidates: UnitState[] =
    spec.side === 'friendly'
      ? unitsOf(state, source.owner)
      : spec.side === 'enemy'
        ? unitsOf(state, opponent(source.owner))
        : [...unitsOf(state, 0), ...unitsOf(state, 1)];

  return candidates.filter((target) => {
    const tp = profileOf(scenario, target);
    if (tp.isFactionTerrain) return false;
    if (spec.keywords) {
      for (const kw of spec.keywords) {
        if (!hasKeyword(scenario, target, kw)) return false;
      }
    }
    if (spec.excludeKeywords) {
      for (const kw of spec.excludeKeywords) {
        if (hasKeyword(scenario, target, kw)) return false;
      }
    }
    if (spec.filter && !spec.filter(scenario, state, source, target)) return false;

    if (reachedByRange(scenario, state, source, target, spec)) return true;

    if (spec.allowCreepingOvergrowth) {
      return reachedThroughOvergrowth(scenario, state, source, target, spec);
    }
    return false;
  });
}

/**
 * The range branch of a targeted spell, prayer or ability: within (or wholly within) the printed
 * range of the caster, and visible to it (every such printed text says "visible"; owner's
 * ruling I75, 2026-11-18).
 */
function reachedByRange(
  scenario: Scenario,
  state: GameState,
  source: UnitState,
  target: UnitState,
  spec: AbilityTargetSpec,
): boolean {
  const inRange = spec.whollyWithin
    ? unitWhollyWithin(scenario, source, target, spec.range)
    : unitsWithin(scenario, source, target, spec.range);
  return inRange && isUnitVisible(scenario, state, source, target);
}

/**
 * The creeping overgrowth branch ("... or that is wholly within the creeping overgrowth"):
 * it is measured from the overgrowth, not the caster, so it needs no visibility (owner's
 * ruling I75, 2026-11-18, for Sylvaneth spells and prayers measured from the overgrowth).
 *
 * Enrage The Spites has the same structure and is covered by the same ruling (I75).
 */
export function reachedThroughOvergrowth(
  scenario: Scenario,
  state: GameState,
  source: UnitState,
  target: UnitState,
  spec: AbilityTargetSpec,
): boolean {
  return inCreepingOvergrowth(
    scenario,
    state,
    target,
    source.owner,
    spec.creepingOvergrowthWholly ?? Boolean(spec.whollyWithin),
  );
}

/** Every ability of `unit`: its warscroll's and those of the enhancements it carries. */
export function abilitiesOf(scenario: Scenario, unit: UnitState): readonly { id: string }[] {
  const profile = profileOf(scenario, unit);
  const army = scenario.armies[unit.owner].units[unit.armyIndex];
  if (!army || unit.enhancementsLost || army.enhancements.length === 0) return profile.abilities;
  return [...profile.abilities, ...army.enhancements.map((e) => e.ability)];
}

export function unitGrants(scenario: Scenario, state: GameState, unit: UnitState): UnitGrants {
  const grants: UnitGrants = {
    keywords: [],
    chargeRollModifier: 0,
  };
  const profile = profileOf(scenario, unit);
  if (profile.ward !== null && profile.ward !== undefined) {
    grants.ward = profile.ward;
  }

  for (const ab of abilitiesOf(scenario, unit)) {
    const def = REGISTRY.get(ab.id);
    if (def?.passiveGrants) {
      mergeGrants(grants, def.passiveGrants(unit, scenario, state));
    }
  }

  const auras = auraDefinitions();
  if (auras.length > 0 && unit.status === 'battlefield') {
    for (const id of state.unitOrder) {
      const source = state.units[id]!;
      if (source.status !== 'battlefield') continue;
      const sourceAbilities = abilitiesOf(scenario, source);
      for (const def of auras) {
        if (sourceAbilities.some((a) => a.id === def.id)) {
          mergeGrants(grants, def.auraGrants!(source, unit, scenario, state));
        }
      }
    }
  }

  for (const eff of effectsOnUnit(state, unit.id)) {
    const def = REGISTRY.get(eff.id);
    if (def?.effectGrants) {
      mergeGrants(grants, def.effectGrants(eff, unit, scenario, state));
    }
  }

  if (unit.status === 'battlefield') {
    const late = lateAuraDefinitions();
    if (late.length > 0) {
      const current: UnitGrants = { ...grants, keywords: [...grants.keywords] };
      for (const id of state.unitOrder) {
        const source = state.units[id]!;
        if (source.status !== 'battlefield') continue;
        const sourceAbilities = abilitiesOf(scenario, source);
        for (const def of late) {
          if (sourceAbilities.some((a) => a.id === def.id)) {
            mergeGrants(grants, def.lateAuraGrants!(source, unit, scenario, state, current));
          }
        }
      }
    }
  }

  return grants;
}

/** The weapon as `unit` uses it, after the passive abilities that change a characteristic. */
export function abilityWeapon(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  weapon: Weapon,
): Weapon {
  let out = weapon;
  for (const ab of profileOf(scenario, unit).abilities) {
    const def = REGISTRY.get(ab.id);
    if (def?.weaponFor) out = def.weaponFor(unit, out, scenario, state);
  }
  return out;
}

/** The modifier added to each ward roll `unit` makes (an aura's penalty is negative). */
export function wardRollModifier(scenario: Scenario, state: GameState, unit: UnitState): number {
  return unitGrants(scenario, state, unit).wardRollModifier ?? 0;
}

function mergeGrants(into: UnitGrants, add: Partial<UnitGrants>): void {
  if (add.ward !== undefined) {
    into.ward = into.ward === undefined ? add.ward : Math.min(into.ward, add.ward);
  }
  if (add.disableWard) into.disableWard = true;
  if (add.keywords) {
    for (const kw of add.keywords) {
      if (!into.keywords.includes(kw)) into.keywords.push(kw);
    }
  }
  if (add.runAndShoot) into.runAndShoot = true;
  if (add.runAndCharge) into.runAndCharge = true;
  if (add.cannotRun) into.cannotRun = true;
  if (add.ignoreSaveModifiers) into.ignoreSaveModifiers = true;
  if (add.cannotRetreat) into.cannotRetreat = true;
  if (add.wardRollModifier) {
    into.wardRollModifier = (into.wardRollModifier ?? 0) + add.wardRollModifier;
  }
  if (add.moveBonus) into.moveBonus = (into.moveBonus ?? 0) + add.moveBonus;
  if (add.chargeRollModifier) into.chargeRollModifier += add.chargeRollModifier;
}

export function effectiveWard(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): number | undefined {
  const g = unitGrants(scenario, state, unit);
  return g.disableWard ? undefined : g.ward;
}

export function hasEffectiveKeyword(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
  keyword: string,
): boolean {
  if (hasKeyword(scenario, unit, keyword)) return true;
  return unitGrants(scenario, state, unit).keywords.includes(keyword);
}

/**
 * Strike order tier for `unit` in the combat phase.
 * If a unit has both STRIKE-FIRST and STRIKE-LAST, they cancel out and the unit fights in the
 * normal tier (Core Rules 19.0).
 */
export function strikeOrder(scenario: Scenario, state: GameState, unit: UnitState): FightTier {
  const first = hasEffectiveKeyword(scenario, state, unit, 'STRIKE-FIRST');
  const last = hasEffectiveKeyword(scenario, state, unit, 'STRIKE-LAST');
  if (first && !last) return 'strikeFirst';
  if (last && !first) return 'strikeLast';
  return 'normal';
}

export function abilityAttackModifiers(
  scenario: Scenario,
  state: GameState,
  sit: AttackSituation,
): Modifier[] {
  const out: Modifier[] = [];

  // Attack-flag bridges onto registered command definitions. All-out Attack applies only to
  // the attacks it was bought for (the `resolve` frame's flag), never to later attacks.
  if (sit.allOutAttack) {
    const def = REGISTRY.get('allOutAttack');
    if (def?.effectModifiers) {
      out.push(
        ...def.effectModifiers(
          {
            id: 'allOutAttack',
            name: 'All-out Attack',
            sourceUnit: sit.attacker.id,
            targetUnit: sit.attacker.id,
            owner: sit.attacker.owner,
            expires: 'phase',
          },
          sit,
          scenario,
          state,
        ),
      );
    }
  }
  // A unit that used All-out Attack this turn has -1 to its save rolls until the end of the
  // turn (corrected by the owner, 2026-11-11).
  if (sit.target.allOutAttack) {
    out.push({ stat: 'save', value: -1, source: 'All-out Attack' });
  }
  if (sit.allOutDefence) {
    const def = REGISTRY.get('allOutDefence');
    if (def?.effectModifiers) {
      out.push(
        ...def.effectModifiers(
          {
            id: 'allOutDefence',
            name: 'All-out Defence',
            sourceUnit: sit.target.id,
            targetUnit: sit.target.id,
            owner: sit.target.owner,
            expires: 'phase',
          },
          sit,
          scenario,
          state,
        ),
      );
    }
  }
  if (sit.coveringFire) {
    const def = REGISTRY.get('coveringFire');
    if (def?.effectModifiers) {
      out.push(
        ...def.effectModifiers(
          {
            id: 'coveringFire',
            name: 'Covering Fire',
            sourceUnit: sit.attacker.id,
            targetUnit: sit.attacker.id,
            owner: sit.attacker.owner,
            expires: 'attack',
          },
          sit,
          scenario,
          state,
        ),
      );
    }
  }

  for (const ab of abilitiesOf(scenario, sit.target)) {
    const def = REGISTRY.get(ab.id);
    if (def?.defenceModifiers) out.push(...def.defenceModifiers(sit.target, sit, scenario, state));
  }
  for (const ab of abilitiesOf(scenario, sit.attacker)) {
    const def = REGISTRY.get(ab.id);
    if (def?.offenceModifiers)
      out.push(...def.offenceModifiers(sit.attacker, sit, scenario, state));
  }

  // Manifestations that modify every attack near them (Pull of the Nadir).
  if (areaDefinitions().length > 0) {
    for (const id of state.unitOrder) {
      const source = state.units[id]!;
      if (!source.isManifestation || source.status !== 'battlefield') continue;
      for (const ab of profileOf(scenario, source).abilities) {
        const def = REGISTRY.get(ab.id);
        if (def?.areaModifiers) out.push(...def.areaModifiers(source, sit, scenario, state));
      }
    }
  }

  // Faction terrain acts for its army through its abilities (I74): one lookup per attack.
  const terrain = state.units[`${sit.attacker.owner}:terrain`];
  if (terrain && terrain.status === 'battlefield') {
    for (const ab of abilitiesOf(scenario, terrain)) {
      const def = REGISTRY.get(ab.id);
      if (def?.terrainModifiers) out.push(...def.terrainModifiers(terrain, sit, scenario, state));
    }
  }

  for (const eff of state.effects ?? []) {
    // Avoid double-counting if allOutAttack/allOutDefence/coveringFire was also passed via `sit`
    if (
      (eff.id === 'allOutAttack' && sit.allOutAttack) ||
      (eff.id === 'allOutDefence' && sit.allOutDefence) ||
      (eff.id === 'coveringFire' && sit.coveringFire)
    ) {
      continue;
    }
    const def = REGISTRY.get(eff.id);
    if (def?.effectModifiers) {
      out.push(...def.effectModifiers(eff, sit, scenario, state));
    }
  }

  return out;
}

export function fireTriggers(ctx: StepCtx, window: TriggerWindow, payload: TriggerPayload): void {
  const effects = [...(ctx.s.effects ?? [])];
  for (const eff of effects) {
    const def = REGISTRY.get(eff.id);
    if (def?.triggerWindow === window && def.onTrigger) {
      def.onTrigger(eff, ctx, payload);
    }
  }
}

export { enemiesWithin };
