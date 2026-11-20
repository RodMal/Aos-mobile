/**
 * Seraphon activated abilities (task M4h): Venomite Swarm, Scry the Stars, Ark of Sotek, Armour
 * Cruncher and Star-venom (used with one `ability` action), and the two reactions to a declared
 * spell, Celestial Conduit and Coatl Familiar. This module holds who may use each and what it
 * does; the effects that last are registered in `abilities/seraphon.ts`. Printed text is in
 * data/factions/seraphon.json; readings in docs/RULES-DECISIONS.md I104 and I105.
 */
import { clampFury } from '../rules/core/fury.js';
import { isWizard } from '../rules/factions/kroak.js';
import { abilitiesOf, addEffect } from './abilities/effects.js';
import {
  ARK_OF_SOTEK_ID,
  ARMOUR_CRUNCHER_ID,
  CELESTIAL_CONDUIT_ID,
  COATL_FAMILIAR_ID,
  DARTPIPE_DAMAGE_ID,
  SCRY_THE_STARS_ID,
  STAR_VENOM_ID,
  VENOMITE_SWARM_ID,
} from './abilities/seraphon.js';
import { d6s, illegal, rollD3, rollD6, type Ctx } from './ctx.js';
import { inflictMortalDamage } from './damage.js';
import { battleKey, usedThisBattle, usedThisTurn } from './relocate.js';
import {
  COMBAT_RANGE,
  enemiesInCombat,
  enemiesWithin,
  hasKeyword,
  opponent,
  profileOf,
  unitWhollyWithin,
  unitsOf,
  unitsWithin,
} from './query.js';
import type {
  Action,
  GameState,
  ReactionOption,
  Scenario,
  UnitId,
  UnitOption,
  UnitState,
} from './types.js';

type AbilityAction = Extract<Action, { t: 'ability' }>;
type AbilityOption = Extract<UnitOption, { t: 'ability' }>;

/** Armour Cruncher without spending a rage dice: the `ability` action id of that choice. */
export const ARMOUR_CRUNCHER_ROLL_ID = 'f6fe-3e8d-dd90-00b8:roll';

/** The abilities that are one `ability` action by the unit itself (the reactions are answers). */
export const SERAPHON_ACTIVATED_IDS: readonly string[] = [SCRY_THE_STARS_ID, STAR_VENOM_ID];

export const SCRY_RANGE = 18;
export const ARK_RANGE = 9;
export const ARK_MAX_TARGETS = 3;
export const COATL_REACTION = 'coatlFamiliar';
export const CONDUIT_REACTION = 'celestialConduit';

const has = (scenario: Scenario, unit: UnitState, id: string): boolean =>
  abilitiesOf(scenario, unit).some((a) => a.id === id);

const usable = (scenario: Scenario, unit: UnitState): boolean =>
  unit.status === 'battlefield' &&
  !profileOf(scenario, unit).isFactionTerrain &&
  !unit.isManifestation;

/** Units on the battlefield that a target list may hold (no faction terrain). */
const targetable = (scenario: Scenario, unit: UnitState): boolean =>
  unit.status === 'battlefield' && !profileOf(scenario, unit).isFactionTerrain;

const usedByUnit = (unit: UnitState, id: string): boolean =>
  (unit.abilitiesUsed ?? []).includes(id);

function option(
  id: string,
  name: string,
  targets: UnitId[],
  extra: Partial<AbilityOption> = {},
): AbilityOption {
  return { ...extra, t: 'ability', abilityId: id, name, kind: 'activated', targets };
}

// ─── Options ────────────────────────────────────────────────────────────────────

/** Scry the Stars: "Once Per Battle (Army), Your Hero Phase". */
export function scryOptions(scenario: Scenario, state: GameState, unit: UnitState): UnitOption[] {
  if (state.phase !== 'hero' || state.active !== unit.owner || state.stack.length > 0) return [];
  if (!usable(scenario, unit) || !has(scenario, unit, SCRY_THE_STARS_ID)) return [];
  if ((state.players[unit.owner].usedOncePerBattle ?? []).includes(SCRY_THE_STARS_ID)) return [];
  // The dice are rolled first and the units are picked afterwards (R12): no target here.
  return scryCandidates(scenario, state, unit).length === 0
    ? []
    : [option(SCRY_THE_STARS_ID, 'Scry the Stars', [])];
}

/** The friendly Seraphon units Scry the Stars may protect: wholly within 18" (the unit itself too). */
export function scryCandidates(scenario: Scenario, state: GameState, unit: UnitState): UnitId[] {
  return unitsOf(state, unit.owner)
    .filter(
      (u) =>
        usable(scenario, u) &&
        hasKeyword(scenario, u, 'SERAPHON') &&
        (u.id === unit.id || unitWhollyWithin(scenario, unit, u, SCRY_RANGE)),
    )
    .map((u) => u.id);
}

/** Star-venom: "Any Shooting Phase", against a unit the Dartpipe allocated damage to this turn. */
export function starVenomOptions(
  scenario: Scenario,
  state: GameState,
  unit: UnitState,
): UnitOption[] {
  if (state.phase !== 'shooting' || state.active !== unit.owner || state.stack.length > 0) {
    return [];
  }
  const targets = starVenomTargets(scenario, state, unit);
  return targets.length === 0 ? [] : [option(STAR_VENOM_ID, 'Star-venom', targets)];
}

/**
 * The enemy units Star-venom may be used on, in any shooting phase: those the unit's Dartpipe
 * allocated damage to this turn (R12). In the enemy turn it is offered after Covering Fire
 * (`starVenomReactions`), once the active player has finished (Core 13.0).
 */
export function starVenomTargets(scenario: Scenario, state: GameState, unit: UnitState): UnitId[] {
  if (!usable(scenario, unit) || !has(scenario, unit, STAR_VENOM_ID)) return [];
  if (usedByUnit(unit, STAR_VENOM_ID)) return [];
  return [
    ...new Set(
      (state.effects ?? [])
        .filter((e) => e.id === DARTPIPE_DAMAGE_ID && e.sourceUnit === unit.id)
        .map((e) => e.targetUnit),
    ),
  ].filter((id) => {
    const t = state.units[id];
    return t !== undefined && targetable(scenario, t);
  });
}

/** Star-venom offered to the player who is not active, as a reaction after their Covering Fire. */
export function starVenomReactions(
  scenario: Scenario,
  state: GameState,
  player: 0 | 1,
): ReactionOption[] {
  const out: ReactionOption[] = [];
  for (const u of unitsOf(state, player)) {
    const targets = starVenomTargets(scenario, state, u);
    if (targets.length > 0) out.push({ ability: 'starVenom', unit: u.id, cost: 0, targets });
  }
  return out;
}

/** Answers a `starVenom` reaction: the target must be one the option lists. */
export function useStarVenomReaction(
  ctx: Ctx,
  option: ReactionOption,
  unitId: UnitId,
  targetId: UnitId | undefined,
): void {
  const unit = ctx.s.units[unitId]!;
  const target = targetId ?? option.targets?.[0];
  if (!target || !option.targets?.includes(target)) illegal('That is not a target for Star-venom.');
  starVenom(ctx, unit, ctx.s.units[target]!);
}

/** The enemy units Armour Cruncher may still be used on (it does not stack on a target). */
function cruncherTargets(scenario: Scenario, state: GameState, unit: UnitState): UnitId[] {
  return enemiesInCombat(scenario, state, unit)
    .filter(
      (e) =>
        !(state.effects ?? []).some(
          (x) => x.id === ARMOUR_CRUNCHER_ID && x.sourceUnit === unit.id && x.targetUnit === e.id,
        ),
    )
    .map((e) => e.id);
}

/** Venomite Swarm's targets: enemies in combat with the unit (a start-of-combat ability, R14). */
export function venomiteTargets(scenario: Scenario, state: GameState, unit: UnitState): string[] {
  if (state.phase !== 'combat' || !usable(scenario, unit)) return [];
  if (!has(scenario, unit, VENOMITE_SWARM_ID) || unit.venomitesGone) return [];
  if (usedThisTurn(state, unit, VENOMITE_SWARM_ID)) return [];
  return enemiesInCombat(scenario, state, unit).map((e) => e.id);
}

/** Ark of Sotek's targets: enemies within 9" (a start-of-combat ability, R14). */
export function arkTargets(scenario: Scenario, state: GameState, unit: UnitState): string[] {
  if (state.phase !== 'combat' || !usable(scenario, unit)) return [];
  if (!has(scenario, unit, ARK_OF_SOTEK_ID) || usedThisTurn(state, unit, ARK_OF_SOTEK_ID))
    return [];
  return enemiesWithin(scenario, state, unit, ARK_RANGE).map((e) => e.id);
}

/**
 * Armour Cruncher: "Any Combat Phase", a start-of-combat ability (Core 13.1, owner 2026-11-20): the
 * targets it may take (enemies in combat with the unit, not already crunched by it). Spending a
 * rage dice needs one; rolling a dice does not (`anyPhase.ts` offers both).
 */
export function cruncherAvailable(scenario: Scenario, state: GameState, unit: UnitState): string[] {
  if (state.phase !== 'combat' || !usable(scenario, unit)) return [];
  if (!has(scenario, unit, ARMOUR_CRUNCHER_ID) || usedByUnit(unit, ARMOUR_CRUNCHER_ID)) return [];
  return cruncherTargets(scenario, state, unit);
}

// ─── Using them ─────────────────────────────────────────────────────────────────

function pickedTargets(action: AbilityAction, opt: AbilityOption, name: string): UnitId[] {
  const ids = action.targets ?? (action.target ? [action.target] : opt.targets.slice(0, 1));
  const max = opt.maxTargets ?? 1;
  if (ids.length < 1 || ids.length > max) illegal(`${name} takes 1 to ${max} targets.`);
  if (new Set(ids).size !== ids.length) illegal(`${name}: each target can be picked only once.`);
  const bad = ids.find((id) => !opt.targets.includes(id));
  if (bad) illegal(`${bad} is not a legal target for ${name}.`);
  return ids;
}

function roll(ctx: Ctx, unit: UnitState, label: string, dice: number[]): void {
  ctx.events.push({ t: 'roll', player: unit.owner, label, dice });
}

function markArmy(ctx: Ctx, unit: UnitState, id: string): void {
  const p = ctx.s.players[unit.owner];
  p.usedOncePerTurn = [...(p.usedOncePerTurn ?? []), id];
}

function markUnit(unit: UnitState, id: string): void {
  unit.abilitiesUsed = [...(unit.abilitiesUsed ?? []), id];
}

/** Uses one of `SERAPHON_ACTIVATED_IDS`: the same checks as the options, then the roll. */
export function useSeraphonAbility(ctx: Ctx, action: AbilityAction): void {
  const { scenario, s } = ctx;
  const unit = s.units[action.unit];
  if (!unit) illegal('Unknown unit.');
  const options =
    action.abilityId === SCRY_THE_STARS_ID
      ? scryOptions(scenario, s, unit)
      : starVenomOptions(scenario, s, unit);
  const opt = options.find(
    (o): o is AbilityOption => o.t === 'ability' && o.abilityId === action.abilityId,
  );
  if (!opt) illegal(`${unit.name} cannot use that ability now.`);
  if (action.abilityId === SCRY_THE_STARS_ID) return scryTheStars(ctx, unit);
  const ids = pickedTargets(action, opt, opt.name);
  const targets = ids.map((id) => s.units[id]!);
  return starVenom(ctx, unit, targets[0]!);
}

/**
 * Scry the Stars: a dice for each battle round, rolled first (R12, owner 2026-11-19). Each 3+
 * gives Ward (5+) to a unit the player then picks (`chooseScry`); no 3+ gives nothing.
 */
function scryTheStars(ctx: Ctx, unit: UnitState): void {
  const { s } = ctx;
  const p = s.players[unit.owner];
  p.usedOncePerBattle = [...(p.usedOncePerBattle ?? []), SCRY_THE_STARS_ID];
  markUnit(unit, SCRY_THE_STARS_ID);
  const dice = d6s(ctx, Math.max(1, s.round));
  roll(ctx, unit, 'Scry the Stars', dice);
  const successes = dice.filter((d) => d >= 3).length;
  const units = scryCandidates(ctx.scenario, s, unit);
  if (successes === 0 || units.length === 0) {
    ctx.events.push({
      t: 'note',
      text: `${unit.name} scries the stars: 0 of ${dice.length} dice on 3+.`,
    });
    return;
  }
  s.stack.push({ t: 'scry', player: unit.owner, unit: unit.id, dice, successes, units });
}

/** Answers the Scry the Stars pick: `value` is 1 to `successes` unit ids joined by commas. */
export function chooseScry(ctx: Ctx, value: string): void {
  const { s } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (frame?.t !== 'scry') illegal('There is no Scry the Stars to answer.');
  const max = Math.min(frame.successes, frame.units.length);
  const picks = [
    ...new Set(
      value
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  if (picks.length < 1 || picks.length > max) illegal(`Pick 1 to ${max} units for Ward (5+).`);
  if (picks.some((id) => !frame.units.includes(id))) {
    illegal('Scry the Stars protects friendly Seraphon units wholly within 18".');
  }
  s.stack.pop();
  for (const id of picks) {
    addEffect(s, {
      id: SCRY_THE_STARS_ID,
      name: 'Scry the Stars',
      sourceUnit: frame.unit,
      targetUnit: id,
      owner: frame.player,
      expires: 'startOfNextTurn',
    });
  }
  ctx.events.push({
    t: 'note',
    text:
      `${s.units[frame.unit]!.name} scries the stars: ${frame.successes} of ${frame.dice.length} dice on 3+; ` +
      `${picks.map((id) => s.units[id]!.name).join(', ')} ${picks.length > 1 ? 'have' : 'has'} Ward (5+).`,
  });
}

/** Venomite Swarm: a D3; a 1 removes the token, 2+ is that much mortal damage. */
export function venomiteSwarm(ctx: Ctx, unit: UnitState, target: UnitState): void {
  markArmy(ctx, unit, VENOMITE_SWARM_ID);
  markUnit(unit, VENOMITE_SWARM_ID);
  const die = rollD3(ctx, unit.owner, 'Venomite Swarm');
  if (die === 1) {
    unit.venomitesGone = true;
    ctx.events.push({
      t: 'note',
      text: `${unit.name}: the Venomites token is removed from the battlefield.`,
    });
    return;
  }
  inflictMortalDamage(ctx, target, die, 'Venomite Swarm');
}

/** Ark of Sotek: a D3 for each target, and 2+ is that much mortal damage. */
export function arkOfSotek(ctx: Ctx, unit: UnitState, targets: UnitState[]): void {
  markArmy(ctx, unit, ARK_OF_SOTEK_ID);
  markUnit(unit, ARK_OF_SOTEK_ID);
  for (const target of targets) {
    const die = rollD3(ctx, unit.owner, 'Ark of Sotek');
    if (die >= 2) inflictMortalDamage(ctx, target, die, 'Ark of Sotek');
  }
}

/**
 * Armour Cruncher: "You can spend 1 rage dice. If you do: apply the effect, and if your
 * opponent's fury level is lower than yours they raise it by 1 (to 7). Otherwise, roll a dice:
 * on the target's Save or more, apply the effect" (I105). Spending always applies the -1 to
 * save rolls for the rest of the turn; not spending rolls for it.
 */
export function armourCruncher(ctx: Ctx, unit: UnitState, target: UnitState, spend: boolean): void {
  const { s, scenario } = ctx;
  const me = s.players[unit.owner];
  const them = s.players[opponent(unit.owner)];
  markUnit(unit, ARMOUR_CRUNCHER_ID);
  let applies: boolean;
  if (spend) {
    me.rageDice = Math.max(0, (me.rageDice ?? 0) - 1);
    applies = true;
    if ((them.furyLevel ?? 0) < (me.furyLevel ?? 0)) {
      them.furyLevel = clampFury((them.furyLevel ?? 0) + 1);
      ctx.events.push({
        t: 'note',
        text: `${unit.name}: Armour Cruncher raises the opponent's fury level to ${them.furyLevel}.`,
      });
    }
  } else {
    const die = rollD6(ctx);
    roll(ctx, unit, 'Armour Cruncher', [die]);
    applies = die >= profileOf(scenario, target).save;
  }
  if (!applies) return;
  addEffect(s, {
    id: ARMOUR_CRUNCHER_ID,
    name: 'Armour Cruncher',
    sourceUnit: unit.id,
    targetUnit: target.id,
    owner: unit.owner,
    expires: 'turn',
  });
  ctx.events.push({
    t: 'note',
    text: `${target.name} has -1 to save rolls for the rest of the turn.`,
  });
}

/** Star-venom: a dice; 2+ gives the target -1 to the wound rolls of its combat attacks this turn. */
function starVenom(ctx: Ctx, unit: UnitState, target: UnitState): void {
  markUnit(unit, STAR_VENOM_ID);
  const die = rollD6(ctx);
  roll(ctx, unit, 'Star-venom', [die]);
  if (die < 2) return;
  addEffect(ctx.s, {
    id: STAR_VENOM_ID,
    name: 'Star-venom',
    sourceUnit: unit.id,
    targetUnit: target.id,
    owner: unit.owner,
    expires: 'turn',
  });
  ctx.events.push({
    t: 'note',
    text: `${target.name} has -1 to wound rolls for its combat attacks for the rest of the turn.`,
  });
}

// ─── Reactions to a declared spell ──────────────────────────────────────────────

/**
 * The reactions a declared Spell ability of `caster` may be answered with: Celestial Conduit
 * (a Bearer with the caster wholly within 12") and Coatl Familiar (a unit carrying it, once per
 * battle, with the caster within its combat range; the carrier itself counts).
 */
export function castReactionOptions(
  scenario: Scenario,
  state: GameState,
  caster: UnitState,
  taken: readonly { ability: string; unit: UnitId }[] = [],
): ReactionOption[] {
  if (!hasKeyword(scenario, caster, 'SERAPHON') || !isWizard(scenario, caster)) return [];
  const out: ReactionOption[] = [];
  for (const u of unitsOf(state, caster.owner)) {
    if (!usable(scenario, u)) continue;
    if (
      has(scenario, u, CELESTIAL_CONDUIT_ID) &&
      !usedByUnit(u, CELESTIAL_CONDUIT_ID) &&
      !taken.some((t) => t.ability === CONDUIT_REACTION && t.unit === u.id) &&
      (u.id === caster.id || unitWhollyWithin(scenario, u, caster, 12))
    ) {
      out.push({ ability: CONDUIT_REACTION, unit: u.id, cost: 0 });
    }
    if (
      has(scenario, u, COATL_FAMILIAR_ID) &&
      !usedThisBattle(state, u, COATL_FAMILIAR_ID) &&
      !taken.some((t) => t.ability === COATL_REACTION && t.unit === u.id) &&
      (u.id === caster.id || unitsWithin(scenario, u, caster, COMBAT_RANGE))
    ) {
      out.push({ ability: COATL_REACTION, unit: u.id, cost: 0 });
    }
  }
  return out;
}

/** The ability id an answer to a `celestialConduit` or `coatlFamiliar` option uses. */
export const castReactionAbilityId = (ability: string): string =>
  ability === CONDUIT_REACTION ? CELESTIAL_CONDUIT_ID : COATL_FAMILIAR_ID;

/** Marks a reaction as used (Conduit once per unit per turn, Coatl Familiar once per battle). */
export function spendCastReaction(
  ctx: Ctx,
  ability: 'celestialConduit' | 'coatlFamiliar',
  unit: UnitState,
): void {
  if (ability === CONDUIT_REACTION) {
    markUnit(unit, CELESTIAL_CONDUIT_ID);
    return;
  }
  const p = ctx.s.players[unit.owner];
  p.usedOncePerBattle = [...(p.usedOncePerBattle ?? []), battleKey(unit, COATL_FAMILIAR_ID)];
}

/** Celestial Conduit: for the rest of the turn the Bearer's bonus to control scores applies. */
export function applyConduit(ctx: Ctx, bearerId: UnitId): void {
  const bearer = ctx.s.units[bearerId];
  if (!bearer || bearer.status !== 'battlefield') return;
  addEffect(ctx.s, {
    id: CELESTIAL_CONDUIT_ID,
    name: 'Celestial Conduit',
    sourceUnit: bearer.id,
    targetUnit: bearer.id,
    owner: bearer.owner,
    expires: 'turn',
  });
  ctx.events.push({
    t: 'note',
    text: `${bearer.name}: Celestial Conduit adds 3 to the control scores of Seraphon units wholly within 12" for the rest of the turn.`,
  });
}
