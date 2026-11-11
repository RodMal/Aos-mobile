import type { AttackSituation, Modifier } from '../../rules/core/modifiers.js';
import type { StepCtx } from '../damage.js';
import {
  enemiesWithin,
  hasKeyword,
  inCreepingOvergrowth,
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

export function registerAbility(def: AbilityDefinition): void {
  REGISTRY.set(def.id, def);
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

    const inRange = spec.whollyWithin
      ? unitWhollyWithin(scenario, source, target, spec.range)
      : unitsWithin(scenario, source, target, spec.range);
    if (inRange) return true;

    if (spec.allowCreepingOvergrowth) {
      return inCreepingOvergrowth(
        scenario,
        state,
        target,
        source.owner,
        Boolean(spec.whollyWithin),
      );
    }
    return false;
  });
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

  for (const ab of profile.abilities) {
    const def = REGISTRY.get(ab.id);
    if (def?.passiveGrants) {
      mergeGrants(grants, def.passiveGrants(unit, scenario, state));
    }
  }

  for (const eff of effectsOnUnit(state, unit.id)) {
    const def = REGISTRY.get(eff.id);
    if (def?.effectGrants) {
      mergeGrants(grants, def.effectGrants(eff, unit, scenario, state));
    }
  }

  return grants;
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
