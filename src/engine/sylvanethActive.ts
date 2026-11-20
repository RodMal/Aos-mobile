/**
 * Sylvaneth activated abilities (task M4i): Lifebloom, Living Battering Ram and Groundshaker
 * (each used with one `ability` action), and Wyldwood Revenants (a reaction to an unmodified
 * chanting roll of 1). Aspect of Heartwood changes Endless Growth and lives in
 * `rules/factions/sylvaneth.ts`. Printed text is in data/factions/sylvaneth.json; readings in
 * docs/RULES-DECISIONS.md I106 and I107.
 */
import { abilitiesOf, addEffect, hasEffectiveKeyword } from './abilities/effects.js';
import {
  GROUNDSHAKER_ID,
  LIFEBLOOM_ID,
  LIVING_BATTERING_RAM_ID,
  WYLDWOOD_REVENANTS_ID,
} from './abilities/sylvaneth.js';
import { d6s, illegal, rollD6, type Ctx } from './ctx.js';
import { healUnit, inflictMortalDamage } from './damage.js';
import { usedThisTurn } from './relocate.js';
import {
  enemiesInCombat,
  enemiesWithin,
  hasKeyword,
  profileOf,
  unitWhollyWithin,
  unitsOf,
} from './query.js';
import { isUnitVisible } from './terrain.js';
import type {
  Action,
  GameState,
  ReactionOption,
  Scenario,
  UnitOption,
  UnitState,
} from './types.js';

export { WYLDWOOD_REVENANTS_ID };

type AbilityAction = Extract<Action, { t: 'ability' }>;
type AbilityOption = Extract<UnitOption, { t: 'ability' }>;

/** The abilities that are one `ability` action by the unit itself. */
export const SYLVANETH_ACTIVATED_IDS: readonly string[] = [LIFEBLOOM_ID, LIVING_BATTERING_RAM_ID];

/** Living Battering Ram: "a visible enemy unit within 1"". */
export const RAM_RANGE = 1;
/** Wyldwood Revenants: a Priest "wholly within 12" of this unit". */
export const REVENANTS_RANGE = 12;

/** The ability ids of each army unit (warscroll and enhancements), per scenario: they never change. */
const ABILITY_IDS = new WeakMap<Scenario, Map<string, Set<string>>>();

/** True when the unit's warscroll or an enhancement it carries has ability `id` (cached). */
export function has(scenario: Scenario, unit: UnitState, id: string): boolean {
  let byUnit = ABILITY_IDS.get(scenario);
  if (!byUnit) ABILITY_IDS.set(scenario, (byUnit = new Map()));
  const key = `${unit.owner}:${unit.armyIndex}:${unit.profileId}`;
  let ids = byUnit.get(key);
  if (!ids) byUnit.set(key, (ids = new Set(abilitiesOf(scenario, unit).map((a) => a.id))));
  return ids.has(id);
}

const usable = (scenario: Scenario, unit: UnitState): boolean =>
  unit.status === 'battlefield' &&
  !profileOf(scenario, unit).isFactionTerrain &&
  !unit.isManifestation;

function option(id: string, name: string, targets: string[]): AbilityOption {
  return { t: 'ability', abilityId: id, name, kind: 'activated', targets };
}

// ─── Options ────────────────────────────────────────────────────────────────────

/** Lifebloom could be used by this unit now, whoever's turn it is (the timing is checked by the caller). */
export function lifebloomUsable(scenario: Scenario, state: GameState, unit: UnitState): boolean {
  return (
    has(scenario, unit, LIFEBLOOM_ID) &&
    usable(scenario, unit) &&
    unit.damage > 0 &&
    !usedThisTurn(state, unit, LIFEBLOOM_ID)
  );
}

/**
 * Lifebloom: "Once Per Turn (Army), Any Hero Phase"; offered here in the owner's own hero phase.
 * In the opponent's turn it is a reaction after the active player has finished (R13, I106).
 */
export function lifebloomOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  if (state.phase !== 'hero' || state.active !== unit.owner || state.stack.length > 0) return [];
  return lifebloomUsable(scenario, state, unit) ? [option(LIFEBLOOM_ID, 'Lifebloom', [])] : [];
}

/** Living Battering Ram's targets for a unit that charged this turn: visible enemies within 1". */
export function batteringRamTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): string[] {
  if (!has(scenario, unit, LIVING_BATTERING_RAM_ID) || !usable(scenario, unit)) return [];
  if (!unit.charged || usedThisTurn(state, unit, LIVING_BATTERING_RAM_ID)) return [];
  return enemiesWithin(scenario, state, unit, RAM_RANGE)
    .filter((e) => isUnitVisible(scenario, state, unit, e))
    .map((e) => e.id);
}

/** Living Battering Ram: offered here in the owner's own charge phase; in the opponent's, a reaction (R13). */
export function batteringRamOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  if (state.phase !== 'charge' || state.active !== unit.owner || state.stack.length > 0) return [];
  const targets = batteringRamTargets(scenario, state, unit);
  return targets.length === 0
    ? []
    : [option(LIVING_BATTERING_RAM_ID, 'Living Battering Ram', targets)];
}

/**
 * Groundshaker's targets: "an enemy non-FLY INFANTRY or CAVALRY unit in combat with this unit".
 * The bold keywords read as one phrase, as for The Land Awakens: Infantry that is not Fly, or
 * Cavalry (I107).
 */
export const groundshakerTarget = (scenario: Scenario, unit: UnitState): boolean =>
  hasKeyword(scenario, unit, 'CAVALRY') ||
  (hasKeyword(scenario, unit, 'INFANTRY') && !hasKeyword(scenario, unit, 'FLY'));

/**
 * Groundshaker's targets for a unit: enemies in combat with it that it has not already shaken.
 * It is a start-of-combat ability (Core 13.1, R14): `anyPhase.ts` offers it in that window only,
 * never while a fighter is picked.
 */
export function groundshakerTargets(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): string[] {
  if (state.phase !== 'combat') return [];
  if (!has(scenario, unit, GROUNDSHAKER_ID) || !usable(scenario, unit)) return [];
  if (usedThisTurn(state, unit, GROUNDSHAKER_ID)) return [];
  return enemiesInCombat(scenario, state, unit)
    .filter(
      (e) =>
        groundshakerTarget(scenario, e) &&
        !(state.effects ?? []).some((x) => x.id === GROUNDSHAKER_ID && x.targetUnit === e.id),
    )
    .map((e) => e.id);
}

// ─── Using them ─────────────────────────────────────────────────────────────────

/** Uses one of `SYLVANETH_ACTIVATED_IDS`: the same checks as the options, then the roll. */
export function useSylvanethAbility(ctx: Ctx, action: AbilityAction): void {
  const { scenario, s } = ctx;
  const unit = s.units[action.unit];
  if (!unit) illegal('Unknown unit.');
  const options =
    action.abilityId === LIFEBLOOM_ID
      ? lifebloomOptions(scenario, s, unit)
      : batteringRamOptions(scenario, s, unit);
  const opt = options.find(
    (o): o is AbilityOption => o.t === 'ability' && o.abilityId === action.abilityId,
  );
  if (!opt) illegal(`${unit.name} cannot use that ability now.`);
  if (action.abilityId === LIFEBLOOM_ID) return useLifebloom(ctx, unit);
  const targetId = action.target ?? opt.targets[0]!;
  if (!opt.targets.includes(targetId)) illegal(`${targetId} is not a legal target.`);
  useBatteringRam(ctx, unit, s.units[targetId]!);
}

function markUsed(ctx: Ctx, unit: UnitState, id: string): void {
  const p = ctx.s.players[unit.owner];
  p.usedOncePerTurn = [...(p.usedOncePerTurn ?? []), id];
}

/** Lifebloom, once the timing and the options were checked. */
export function useLifebloom(ctx: Ctx, unit: UnitState): void {
  markUsed(ctx, unit, LIFEBLOOM_ID);
  lifebloom(ctx, unit);
}

/** Living Battering Ram, once the timing and the options were checked. */
export function useBatteringRam(ctx: Ctx, unit: UnitState, target: UnitState): void {
  markUsed(ctx, unit, LIVING_BATTERING_RAM_ID);
  batteringRam(ctx, unit, target);
}

/** Groundshaker, once the timing and the options were checked. */
export function useGroundshaker(ctx: Ctx, unit: UnitState, target: UnitState): void {
  markUsed(ctx, unit, GROUNDSHAKER_ID);
  groundshaker(ctx, unit, target);
}

/** Lifebloom: Heal (2D6) the unit. */
function lifebloom(ctx: Ctx, unit: UnitState): void {
  const dice = d6s(ctx, 2);
  ctx.events.push({ t: 'roll', player: unit.owner, label: 'Lifebloom', dice });
  healUnit(ctx, unit, dice[0]! + dice[1]!, 'Lifebloom');
}

/** Living Battering Ram: a dice; on 3+, mortal damage equal to the roll. */
function batteringRam(ctx: Ctx, unit: UnitState, target: UnitState): void {
  const die = rollD6(ctx);
  ctx.events.push({ t: 'roll', player: unit.owner, label: 'Living Battering Ram', dice: [die] });
  if (die >= 3) inflictMortalDamage(ctx, target, die, 'Living Battering Ram');
}

/** Groundshaker: a dice; on 3+, the target has Strike-last for the rest of the turn. */
function groundshaker(ctx: Ctx, unit: UnitState, target: UnitState): void {
  const die = rollD6(ctx);
  ctx.events.push({ t: 'roll', player: unit.owner, label: 'Groundshaker', dice: [die] });
  if (die < 3) return;
  addEffect(ctx.s, {
    id: GROUNDSHAKER_ID,
    name: 'Groundshaker',
    sourceUnit: unit.id,
    targetUnit: target.id,
    owner: unit.owner,
    expires: 'turn',
  });
  ctx.events.push({
    t: 'note',
    text: `${target.name} has Strike-last for the rest of the turn.`,
  });
}

// ─── Wyldwood Revenants ─────────────────────────────────────────────────────────

/**
 * The Wyldwood Revenants reactions to an unmodified chanting roll of 1 by `priest`: each unit of
 * the priest's army with the ability that has the Sylvaneth Priest wholly within 12" of it (the
 * unit itself counts), while the army has not used it this turn.
 */
export function chantRerollOptions(
  scenario: Scenario,
  state: GameState,
  priest: UnitState,
): ReactionOption[] {
  if (!hasEffectiveKeyword(scenario, state, priest, 'SYLVANETH')) return [];
  if ((profileOf(scenario, priest).priest ?? 0) <= 0) return [];
  const out: ReactionOption[] = [];
  for (const u of unitsOf(state, priest.owner)) {
    if (!usable(scenario, u) || !has(scenario, u, WYLDWOOD_REVENANTS_ID)) continue;
    if (usedThisTurn(state, u, WYLDWOOD_REVENANTS_ID)) continue;
    if (u.id !== priest.id && !unitWhollyWithin(scenario, u, priest, REVENANTS_RANGE)) continue;
    out.push({ ability: 'wyldwoodRevenants', unit: u.id, cost: 0 });
    break; // once per turn for the army: one offer is enough
  }
  return out;
}

/** Marks the reaction used for the turn (it is once per turn per army). */
export function spendChantReroll(ctx: Ctx, unit: UnitState): void {
  const p = ctx.s.players[unit.owner];
  p.usedOncePerTurn = [...(p.usedOncePerTurn ?? []), WYLDWOOD_REVENANTS_ID];
}
