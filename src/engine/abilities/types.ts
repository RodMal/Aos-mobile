import type { Weapon } from '../../data/profile.js';
import type { AttackSituation, Modifier } from '../../rules/core/modifiers.js';
import type { StepCtx } from '../damage.js';
import type { ActiveEffect, MoveKind, Phase, Scenario, UnitState, GameState } from '../types.js';

export type AbilityKind = 'spell' | 'prayer' | 'summon' | 'passive' | 'activated' | 'command';

export type TriggerWindow =
  'afterMove' | 'startOfPhase' | 'endOfPhase' | 'startOfTurn' | 'endOfTurn';

export interface TriggerPayload {
  unit?: UnitState;
  moveKind?: MoveKind;
  phase?: Phase;
}

export interface UnitGrants {
  ward?: number;
  disableWard?: boolean;
  keywords: string[];
  runAndShoot?: boolean;
  runAndCharge?: boolean;
  cannotRun?: boolean;
  ignoreSaveModifiers?: boolean;
  /** The unit cannot use a Retreat ability. */
  cannotRetreat?: boolean;
  /** Added to every ward roll the unit makes (a penalty is negative). */
  wardRollModifier?: number;
  /** Added to the Move characteristic (when it is above 0). */
  moveBonus?: number;
  chargeRollModifier: number;
}

export interface AbilityTargetSpec {
  side: 'friendly' | 'enemy' | 'any';
  range: number;
  whollyWithin?: boolean;
  keywords?: string[];
  excludeKeywords?: string[];
  /** When true, a unit within the caster's Sylvaneth creeping overgrowth also qualifies. */
  allowCreepingOvergrowth?: boolean;
  /** Whether the creeping overgrowth alternative needs "wholly within" (default: `whollyWithin`). */
  creepingOvergrowthWholly?: boolean;
  filter?: (scenario: Scenario, state: GameState, source: UnitState, target: UnitState) => boolean;
}

export interface AbilityResolveArgs {
  ctx: StepCtx;
  unit: UnitState;
  target?: UnitState;
  secondTarget?: UnitState;
  /** Every target picked, when the ability takes several (`maxTargets`). */
  targets?: UnitState[];
  roll?: number;
  choice?: string;
}

export interface AbilityDefinition {
  /** BSData ability ID (or CommandId for command effects). */
  id: string;
  /** Exact name in BSData `data/` (checked by registry.test.ts when `bsdata` is true). */
  name: string;
  kind: AbilityKind;
  /** True when `id` is a BSData ability ID that must exist in `data/`. */
  bsdata?: boolean;
  unlimited?: boolean;
  /** True when the same caster can cast this spell more than once per phase (e.g. Celestial Deliverance). */
  repeatSameUnit?: boolean;
  castingValue?: number;
  chantingValue?: number;
  highChantThreshold?: number;
  summonWarscrollId?: string;
  summonRange?: number;
  summonMinEnemyGap?: number;
  target?: AbilityTargetSpec;
  /** How many targets may be picked ("up to 3"), when more than one. */
  maxTargets?: number;
  canUse?: (scenario: Scenario, state: GameState, unit: UnitState) => boolean;
  resolve?: (args: AbilityResolveArgs) => void;
  /** Attack modifiers evaluated when an ActiveEffect with `effect.id === def.id` is in play. */
  effectModifiers?: (
    effect: ActiveEffect,
    sit: AttackSituation,
    scenario: Scenario,
    state: GameState,
  ) => Modifier[];
  /** Unit grants evaluated when an ActiveEffect with `effect.id === def.id` is on `unit`. */
  effectGrants?: (
    effect: ActiveEffect,
    unit: UnitState,
    scenario: Scenario,
    state: GameState,
  ) => Partial<UnitGrants>;
  /** Passive unit grants when `unit`'s profile has this ability. */
  passiveGrants?: (unit: UnitState, scenario: Scenario, state: GameState) => Partial<UnitGrants>;
  /**
   * Grants this ability gives to `unit` while `source`, a unit whose warscroll has it, is on the
   * battlefield (an aura: "friendly units within 12\" of this unit"). It decides range and
   * allegiance itself, and must not read the grants of `unit` or `source`.
   */
  auraGrants?: (
    source: UnitState,
    unit: UnitState,
    scenario: Scenario,
    state: GameState,
  ) => Partial<UnitGrants>;
  /** Attack modifiers for attacks that target a unit whose warscroll has this ability. */
  defenceModifiers?: (
    self: UnitState,
    sit: AttackSituation,
    scenario: Scenario,
    state: GameState,
  ) => Modifier[];
  /** Attack modifiers for attacks made by a unit whose warscroll (or enhancement) has this ability. */
  offenceModifiers?: (
    self: UnitState,
    sit: AttackSituation,
    scenario: Scenario,
    state: GameState,
  ) => Modifier[];
  /** The weapon as `unit` (whose warscroll has this ability) uses it. */
  weaponFor?: (unit: UnitState, weapon: Weapon, scenario: Scenario, state: GameState) => Weapon;
  /** Trigger fired at `triggerWindow` while an ActiveEffect with `effect.id === def.id` is in play. */
  triggerWindow?: TriggerWindow;
  onTrigger?: (effect: ActiveEffect, ctx: StepCtx, payload: TriggerPayload) => void;
}
